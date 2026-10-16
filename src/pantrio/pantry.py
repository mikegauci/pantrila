"""A person's kitchen: their profile and pantry, stored per user.

Foods are keys of the ingredient table. Free text from people or the model ("red onions",
"Greek yoghurt") goes through `resolve_food`, which only accepts a key it can match exactly
after normalising; anything else comes back with suggestions instead of being guessed.
"""

from __future__ import annotations

import difflib
import json
from typing import Protocol

import psycopg

from pantrio.foods import load_foods, to_grams
from pantrio.schema import PantryItem, Unit, UserProfile

# Spellings people use that normalising alone does not reach.
ALIASES = {
    "eggs": "egg",
    "yoghurt": "plain_yogurt",
    "greek_yoghurt": "greek_yogurt",
    "zucchini": "courgette",
    "eggplant": "aubergine",
    "cilantro": "coriander",
    "arugula": "rocket",
    "scallion": "spring_onion",
    "green_onion": "spring_onion",
    "garbanzo_beans": "chickpeas",
    "bell_pepper": "red_bell_pepper",
    "pepper": "black_pepper",
    "rice": "white_rice",
    "oats": "rolled_oats",
    "flour": "plain_flour",
    "bread": "white_bread",
    "noodles": "egg_noodles",
    "cream": "double_cream",
    "heavy_cream": "double_cream",
    "mince": "beef_mince",
    "ground_beef": "beef_mince",
    "chicken": "chicken_breast",
    "shrimp": "prawns",
    "tuna": "canned_tuna",
    "stock": "vegetable_stock",
    "lentils": "red_lentils",
}


class UnknownFood(ValueError):
    def __init__(self, text: str, suggestions: list[str]):
        hint = f"; did you mean {', '.join(suggestions)}?" if suggestions else ""
        super().__init__(f"{text!r} is not in the ingredient table{hint}")
        self.text, self.suggestions = text, suggestions


def _normalise(text: str) -> str:
    return "_".join(text.lower().replace("-", " ").split())


def resolve_food(text: str) -> str:
    """The food key for a name: the key itself, an alias, or the plural or singular form."""
    foods = load_foods()
    key = _normalise(text)
    for candidate in (key, f"{key}s", key.removesuffix("es"), key.removesuffix("s")):
        if candidate in foods:
            return candidate
        if candidate in ALIASES:
            return ALIASES[candidate]
    raise UnknownFood(text, suggest_foods(text))


def suggest_foods(text: str, limit: int = 4) -> list[str]:
    key = _normalise(text)
    keys = list(load_foods())
    close = difflib.get_close_matches(key, keys, n=limit, cutoff=0.6)
    words = set(key.split("_"))
    sharing = [k for k in keys if words & set(k.split("_")) and k not in close]
    return (close + sorted(sharing))[:limit]


def make_item(
    food: str, quantity: float | None = None, unit: Unit | str | None = None
) -> PantryItem:
    """A pantry item with the amount normalised to grams. Raises UnknownFood or UnitError."""
    key = resolve_food(food)
    if quantity is None or unit is None:
        return PantryItem(food=key)
    unit = Unit(unit)
    return PantryItem(food=key, quantity=quantity, unit=unit, grams=to_grams(key, quantity, unit))


def item_text(item: PantryItem) -> str:
    if item.quantity is None:
        return item.food
    return f"{item.food} ({item.quantity:g} {item.unit}, {item.grams:.0f} g)"


class Kitchen(Protocol):
    """One person's stored profile and pantry."""

    def profile(self) -> UserProfile:
        """The saved profile with `pantry` filled from the pantry items."""
        ...

    def save_profile(self, profile: UserProfile) -> None: ...

    def pantry(self) -> list[PantryItem]: ...

    def put(self, item: PantryItem) -> None:
        """Add the item, or replace the stored one for the same food."""
        ...

    def remove(self, food: str) -> bool: ...


class MemoryKitchen:
    def __init__(self, profile: UserProfile | None = None, pantry: list[PantryItem] = ()):
        self._profile = profile or UserProfile()
        self._pantry = {i.food: i for i in pantry}

    def profile(self) -> UserProfile:
        return self._profile.model_copy(update={"pantry": sorted(self._pantry)})

    def save_profile(self, profile: UserProfile) -> None:
        self._profile = profile.model_copy(update={"pantry": []})

    def pantry(self) -> list[PantryItem]:
        return [self._pantry[f] for f in sorted(self._pantry)]

    def put(self, item: PantryItem) -> None:
        self._pantry[item.food] = item

    def remove(self, food: str) -> bool:
        return self._pantry.pop(food, None) is not None


class DbKitchen:
    def __init__(self, conn: psycopg.Connection, user_id: str):
        if not user_id:
            raise ValueError("user_id is required")
        self.conn, self.user_id = conn, user_id

    def profile(self) -> UserProfile:
        row = self.conn.execute(
            "select profile from user_profiles where user_id = %s", (self.user_id,)
        ).fetchone()
        profile = UserProfile.model_validate(row[0]) if row else UserProfile()
        return profile.model_copy(update={"pantry": [i.food for i in self.pantry()]})

    def save_profile(self, profile: UserProfile) -> None:
        data = profile.model_dump(mode="json", exclude={"pantry"})
        with self.conn.transaction():
            self.conn.execute(
                "insert into user_profiles (user_id, profile) values (%s, %s)"
                " on conflict (user_id) do update set profile = excluded.profile,"
                " updated_at = now()",
                (self.user_id, json.dumps(data)),
            )

    def pantry(self) -> list[PantryItem]:
        rows = self.conn.execute(
            "select food, quantity, unit, grams from pantry_items where user_id = %s order by food",
            (self.user_id,),
        ).fetchall()
        return [
            PantryItem(food=food, quantity=None if q is None else float(q), unit=unit,
                       grams=None if g is None else float(g))
            for food, q, unit, g in rows
        ]  # fmt: skip

    def put(self, item: PantryItem) -> None:
        with self.conn.transaction():
            self.conn.execute(
                "insert into pantry_items (user_id, food, quantity, unit, grams)"
                " values (%s, %s, %s, %s, %s)"
                " on conflict (user_id, food) do update set quantity = excluded.quantity,"
                " unit = excluded.unit, grams = excluded.grams, updated_at = now()",
                (self.user_id, item.food, item.quantity, item.unit and item.unit.value,
                 item.grams),
            )  # fmt: skip

    def remove(self, food: str) -> bool:
        with self.conn.transaction():
            cur = self.conn.execute(
                "delete from pantry_items where user_id = %s and food = %s", (self.user_id, food)
            )
        return cur.rowcount > 0

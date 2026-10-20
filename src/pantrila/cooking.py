"""Cooking a recipe: what it takes out of the pantry when the person says they cooked it.

Amounts are in grams, like the grocery list: each line's grams per serving times the servings
cooked. A pantry item with an amount goes down by what the recipe used, in its own unit, and
is removed once (almost) nothing is left. An item without an amount means "some" and stays,
because Pantrila cannot know whether it ran out.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from pydantic import BaseModel

from pantrila.schema import PantryItem

USED_UP_G = 0.5  # less than this left counts as used up, like the grocery list's EPSILON_G


class PantryChange(BaseModel):
    food: str
    used_g: float
    before: PantryItem
    after: PantryItem | None  # None: used up, so removed


def grams_used(
    lines: Iterable[tuple[str | None, float]], recipe_servings: int, servings: int
) -> dict[str, float]:
    """Grams per food for `servings` of a recipe written for `recipe_servings`. Lines without
    an ingredient-table food (cookbook estimates) are skipped: no pantry item can match them."""
    used: dict[str, float] = defaultdict(float)
    for food, grams in lines:
        if food:
            used[food] += grams / recipe_servings * servings
    return dict(used)


def use_from_pantry(used: dict[str, float], pantry: Iterable[PantryItem]) -> list[PantryChange]:
    """How each measured pantry item changes after cooking, in pantry order."""
    changes = []
    for item in pantry:
        need = used.get(item.food, 0.0)
        if need <= 0 or item.grams is None or item.quantity is None:
            continue
        left = item.grams - need
        after = None
        if left >= USED_UP_G:
            after = PantryItem(food=item.food, unit=item.unit, grams=round(left, 1),
                               quantity=round(item.quantity * left / item.grams, 2))  # fmt: skip
        changes.append(PantryChange(food=item.food, used_g=round(min(need, item.grams), 1),
                                    before=item, after=after))  # fmt: skip
    return changes

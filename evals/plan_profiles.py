"""Deterministic generator for the meal-planning eval profiles.

Each profile is a person the planner must serve: hard rules (allergies, diets, excluded foods,
time limit) that must never be broken, plus targets, a pantry and tastes that the plan is
scored on. The set covers the 14 EU allergens' common cases, every diet in the corpus, tight
and loose nutrition targets, and pantries that do and do not match the corpus well.

    uv run python -m evals.plan_profiles          # rewrite evals/data/plan_profiles.json
"""

from __future__ import annotations

import json
from pathlib import Path

from pantrila.schema import UserProfile

OUT = Path(__file__).parent / "data" / "plan_profiles.json"

B, L, D, S = "breakfast", "lunch", "dinner", "snack"

PROFILES: dict[str, dict] = {
    "omnivore-balanced": {
        "targets": {"kcal": 2000, "min_protein_g": 90},
        "pantry": ["chicken_thigh", "broccoli", "white_rice"],
    },
    "vegan-high-protein": {
        "diets": ["vegan"],
        "targets": {"kcal": 2200, "min_protein_g": 110},
        "pantry": ["tofu", "tempeh", "kale"],
    },
    "vegetarian-nut-allergy": {
        "allergies": ["peanuts", "tree_nuts"],
        "diets": ["vegetarian"],
        "targets": {"kcal": 1900, "min_protein_g": 80},
        "pantry": ["spinach", "feta", "chickpeas"],
        "cuisines": ["greek", "indian"],
    },
    "coeliac": {
        "allergies": ["gluten"],
        "diets": ["gluten_free"],
        "targets": {"kcal": 2100},
        "pantry": ["sweet_potato", "egg", "salmon"],
    },
    "dairy-and-egg-allergy": {
        "allergies": ["milk", "eggs"],
        "targets": {"kcal": 2000, "min_protein_g": 85},
        "pantry": ["black_beans", "avocado", "corn_tortilla"],
        "cuisines": ["mexican"],
    },
    "low-carb": {
        "targets": {"kcal": 1800, "min_protein_g": 120, "max_carbs_g": 100},
        "pantry": ["cauliflower", "chicken_breast", "courgette"],
    },
    "pescatarian-mediterranean": {
        "diets": ["pescatarian"],
        "targets": {"kcal": 2000, "min_protein_g": 90},
        "pantry": ["cod", "cherry_tomato", "olives"],
        "cuisines": ["greek", "italian", "spanish"],
    },
    "quick-weeknights": {
        "max_minutes": 30,
        "targets": {"kcal": 2200},
        "pantry": ["pasta", "canned_tomatoes", "spinach"],
        "notes": "Busy; keep it simple.",
    },
    "seafood-sesame-soy-allergy": {
        "allergies": ["fish", "crustaceans", "molluscs", "sesame", "soy"],
        "targets": {"kcal": 2000},
        "pantry": ["pork_loin", "red_bell_pepper", "rice_noodles"],
        "cuisines": ["thai", "chinese", "vietnamese"],
    },
    "bulking": {
        "meals": [B, L, D, S],
        "targets": {"kcal": 3000, "min_protein_g": 160},
        "pantry": ["rolled_oats", "greek_yogurt", "beef_mince"],
    },
    "cutting": {
        "targets": {"kcal": 1600, "min_protein_g": 130},
        "pantry": ["turkey_mince", "egg", "green_beans"],
    },
    "big-pantry": {
        "targets": {"kcal": 2000},
        "pantry": [
            "chicken_thigh",
            "red_lentils",
            "butternut_squash",
            "spinach",
            "egg",
            "potato",
            "leek",
            "canned_tuna",
            "cheddar",
            "mushroom",
        ],
    },  # fmt: skip
    "picky-eater": {
        "exclude_foods": ["mushroom", "shiitake", "coriander", "aubergine", "olives", "capers"],
        "targets": {"kcal": 2100, "min_protein_g": 80},
        "pantry": ["pork_sausage", "potato"],
        "cuisines": ["british", "american", "french"],
    },
    "vegan-gluten-free": {
        "allergies": ["gluten"],
        "diets": ["vegan", "gluten_free"],
        "targets": {"kcal": 2000, "min_protein_g": 70},
        "pantry": ["quinoa", "chickpeas", "coconut_milk"],
    },
    "with-snacks-and-spice": {
        "meals": [B, L, D, S],
        "targets": {"kcal": 2400, "min_protein_g": 100},
        "pantry": ["chilli", "prawns", "lime"],
        "cuisines": ["thai", "korean", "mexican"],
        "notes": "Loves spicy food.",
    },
    "weekend-lunch-dinner": {
        "days": 3,
        "meals": [L, D],
        "allergies": ["mustard", "celery", "sulphites"],
        "targets": {"kcal": 1500},
        "pantry": ["lamb_shoulder", "couscous"],
        "cuisines": ["moroccan", "middle_eastern"],
    },
}


def generate() -> list[dict]:
    """Validate every profile through UserProfile so the file always loads cleanly."""
    return [
        {"id": pid, "profile": UserProfile.model_validate(spec).model_dump(mode="json")}
        for pid, spec in PROFILES.items()
    ]


def render(profiles: list[dict]) -> str:
    return json.dumps(profiles, indent=2) + "\n"


def load_profiles(path: Path = OUT) -> list[tuple[str, UserProfile]]:
    return [
        (p["id"], UserProfile.model_validate(p["profile"])) for p in json.loads(path.read_text())
    ]


if __name__ == "__main__":
    OUT.write_text(render(generate()))
    print(f"wrote {len(PROFILES)} profiles to {OUT}")

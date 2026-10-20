"""Build data/usda_foods.csv from the USDA FoodData Central SR Legacy release.

SR Legacy is public domain (CC0). The script downloads the CSV release once, keeps only the
foods referenced by data/ingredients.csv and writes energy and macros per 100 g.

    uv run python scripts/build_usda_table.py
"""

from __future__ import annotations

import csv
import io
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INGREDIENTS = ROOT / "data" / "ingredients.csv"
OUT = ROOT / "data" / "usda_foods.csv"
CACHE = ROOT / ".cache" / "fdc_sr_legacy_2018-04.zip"
URL = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"

# FoodData Central nutrient ids.
NUTRIENTS = {
    "1008": "kcal",
    "1003": "protein_g",
    "1005": "carbs_g",
    "1004": "fat_g",
    "1079": "fibre_g",
}


def _read(zf: zipfile.ZipFile, name: str):
    member = next(n for n in zf.namelist() if n.endswith("/" + name))
    with zf.open(member) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8"))


def main() -> None:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {URL}")
        urllib.request.urlretrieve(URL, CACHE)

    with INGREDIENTS.open() as fh:
        wanted = {row["fdc_id"] for row in csv.DictReader(fh) if row["fdc_id"]}

    with zipfile.ZipFile(CACHE) as zf:
        descriptions = {
            row["fdc_id"]: row["description"]
            for row in _read(zf, "food.csv")
            if row["fdc_id"] in wanted
        }
        values: dict[str, dict[str, float]] = {fid: {} for fid in descriptions}
        for row in _read(zf, "food_nutrient.csv"):
            if row["fdc_id"] in values and row["nutrient_id"] in NUTRIENTS:
                values[row["fdc_id"]][NUTRIENTS[row["nutrient_id"]]] = float(row["amount"])

    missing = wanted - descriptions.keys()
    if missing:
        raise SystemExit(f"fdc ids not in SR Legacy: {sorted(missing)}")

    with OUT.open("w", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["fdc_id", "description", *NUTRIENTS.values()])
        for fid in sorted(descriptions, key=int):
            # SR Legacy omits fibre for some foods (meat, oils); absent means zero here.
            row = [round(values[fid].get(col, 0.0), 2) for col in NUTRIENTS.values()]
            writer.writerow([fid, descriptions[fid], *row])
    print(f"wrote {len(descriptions)} foods to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

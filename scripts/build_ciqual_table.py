"""Rebuild the reviewed Ciqual 2025 subset using only the standard library.

Download the manifest URL to .cache/ciqual/2025.xlsx, then run this script. The pinned
checksum is mandatory: a changed upstream workbook requires a new source review.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def workbook_rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as z:
        strings = [
            "".join(x.itertext())
            for x in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("s:si", NS)
        ]
        rows = ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//s:row", NS)
        out = []
        for row in rows:
            values = {}
            for cell in row:
                value = cell.find("s:v", NS)
                if value is not None:
                    values[re.sub(r"\d", "", cell.attrib["r"])] = (
                        strings[int(value.text)] if cell.attrib.get("t") == "s" else value.text
                    )
            out.append(values)
        return out


def numeric(value: str, *, fibre_upper_bound: bool = False) -> float:
    """Never turn unknown or trace values into zero; only fibre permits a censored bound."""
    value = value.strip().replace(",", ".")
    if fibre_upper_bound and value.startswith("<"):
        value = value[1:].strip()
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"unsupported nutrient value: {value!r}") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"invalid nutrient value: {value!r}")
    return number


def normalize(path: Path, manifest: dict) -> list[dict]:
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Ciqual workbook checksum mismatch")
    rows = workbook_rows(path)
    # Fail on changed column definitions even if a future checksum is deliberately updated.
    for column, name in manifest["columns"].items():
        if rows[0][column] != name:
            raise ValueError(f"Ciqual column {column} changed")
    by_code = {r["G"]: r for r in rows[1:]}
    out = []
    for code, description in sorted(manifest["selected"].items(), key=lambda x: int(x[0])):
        r = by_code[code]
        if r["H"] != description:
            raise ValueError(f"Ciqual food {code} changed description")
        fibre = numeric(r["AA"], fibre_upper_bound=True)
        out.append(
            {
                "source_food_code": code,
                "description": description,
                "kcal": numeric(r["M"]),
                "protein_g": numeric(r["O"]),
                "carbs_g": round(numeric(r["Q"]) + fibre, 4),
                "fat_g": numeric(r["R"]),
                "fibre_g": fibre,
                "available_carbs_raw": r["Q"],
                "fibre_raw": r["AA"],
                "fibre_policy": "upper bound" if r["AA"].strip().startswith("<") else "reported",
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / ".cache/ciqual/2025.xlsx")
    parser.add_argument("--output", type=Path, default=ROOT / "data/ciqual_foods.csv")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "data/ciqual_manifest.json").read_text())
    rows = normalize(args.input, manifest)
    with args.output.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} Ciqual foods")


if __name__ == "__main__":
    main()

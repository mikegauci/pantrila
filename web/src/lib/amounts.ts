import type { Unit } from "@/lib/types"

/**
 * How ingredient amounts read: US measures as fractions ("1 1/4 tsp"), metric as whole numbers
 * ("454 g"), and any line shown in another unit from its grams. Display only: the stored
 * recipe keeps its quantity and unit.
 */

/** A unit an amount can be shown in: the stored units plus pounds and ounces. */
export type ShowUnit = Unit | "lb" | "oz"

/** What an ingredient line needs to be shown in another unit. */
export interface Measured {
  quantity: number
  unit: Unit
  grams?: number
  grams_per_ml?: number | null
  grams_per_piece?: number | null
}

// Same factors as the API (foods.py), so conversions match the nutrition.
const ML: Partial<Record<ShowUnit, number>> = { ml: 1, l: 1000, tsp: 4.93, tbsp: 14.79, cup: 240 }
const GRAMS: Partial<Record<ShowUnit, number>> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592, pinch: 0.4 }
const US = new Set<ShowUnit>(["tsp", "tbsp", "cup", "lb", "oz", "piece", "pinch"])

const FRACTIONS: [number, string][] = [
  [0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"], [1, ""],
]
const GLYPHS: Record<string, string> = {
  "1/8": "⅛", "1/4": "¼", "1/3": "⅓", "1/2": "½", "2/3": "⅔", "3/4": "¾", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
}

/** "1¼" for 1.25: the nearest eighth, quarter or third; never 0 for an amount above 0. */
export function fraction(q: number): string {
  let whole = Math.floor(q)
  const [value, text] = FRACTIONS.reduce((best, f) =>
    Math.abs(q - whole - f[0]) < Math.abs(q - whole - best[0]) ? f : best)
  if (value === 1) whole += 1
  if (!whole && !text) return q > 0 ? "⅛" : "0"
  return `${whole || ""}${text}`
}

/** Typed fractions in text as fraction characters: "1 1/2 cups" -> "1½ cups", "1/4 tsp" -> "¼ tsp". */
export function niceFractions(text: string): string {
  return text.replace(/(?<![\d/.])(?:(\d+)(?:\s+|-))?([1-7])\/([2348])(?![\d/])/g,
    (whole, int: string | undefined, n: string, d: string) =>
      GLYPHS[`${n}/${d}`] ? `${int ?? ""}${GLYPHS[`${n}/${d}`]}` : whole)
}

/** The number for `q` in `unit`: fractions for US measures and counts, decimals for metric. */
export function formatAmount(q: number, unit: ShowUnit): string {
  if (US.has(unit)) return fraction(q)
  if (unit === "kg" || unit === "l") return String(Math.round(q * 100) / 100)
  return q < 10 ? String(Math.round(q * 10) / 10) : String(Math.round(q))
}

/** Units this line can be shown in, its own first. Needs its grams; volume and pieces need the food's. */
export function unitsFor(line: Measured): ShowUnit[] {
  if (!line.grams) return [line.unit]
  const units: ShowUnit[] = ["g", "oz", "lb"]
  if (line.grams_per_ml) units.push("ml", "tsp", "tbsp", "cup")
  if (line.grams_per_piece) units.push("piece")
  return [line.unit, ...units.filter((u) => u !== line.unit)]
}

/** The line's amount in `unit`, times `scale` (servings). */
export function amountIn(line: Measured, unit: ShowUnit, scale = 1): number {
  if (unit === line.unit || !line.grams) return line.quantity * scale
  const grams = line.grams * scale
  if (GRAMS[unit]) return grams / GRAMS[unit]
  if (ML[unit] && line.grams_per_ml) return grams / line.grams_per_ml / ML[unit]
  if (unit === "piece" && line.grams_per_piece) return grams / line.grams_per_piece
  return line.quantity * scale
}

/** Grams of `q` in `unit`, or null when the food gives no way to weigh that unit. */
function toGrams(q: number, unit: ShowUnit, perMl?: number | null, perPiece?: number | null): number | null {
  if (GRAMS[unit]) return q * GRAMS[unit]
  if (ML[unit]) return perMl ? q * ML[unit] * perMl : null
  if (unit === "piece") return perPiece ? q * perPiece : null
  return null
}

/** A number the form can show for `unit`: whole grams and ml from 10, else two decimals. */
function tidy(q: number, unit: ShowUnit): number {
  const metric = unit === "g" || unit === "ml"
  return metric && q >= 10 ? Math.round(q) : Math.round(q * 100) / 100
}

/**
 * The same amount in another unit, for the form when the person picks a new unit ("1 cup" of
 * rice becomes "185 g"), or null when the food cannot be converted to it (no density or piece
 * weight); the form then keeps the number.
 */
export function convertAmount(q: number, from: Unit, to: Unit, perMl?: number | null,
                              perPiece?: number | null): number | null {
  if (!Number.isFinite(q) || q <= 0 || from === to) return null
  const grams = toGrams(q, from, perMl, perPiece)
  if (grams === null) return null
  if (GRAMS[to]) return tidy(grams / GRAMS[to], to)
  if (ML[to] && perMl) return tidy(grams / perMl / ML[to], to)
  if (to === "piece" && perPiece) return tidy(grams / perPiece, to)
  return null
}

// A leading amount in a name ("1 cup", "1-1/4 teaspoons", "½ lb", "2 pinches of"), as in the
// API's cookbook.bare_name: older imports kept the whole source line as the name.
const FRACTION_CHAR = "[¼½¾⅓⅔⅛⅜⅝⅞]"
const NUM = `(?:0[.,]\\d+|[1-9]\\d*(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?|${FRACTION_CHAR})(?:[\\s-]*(?:\\d+/\\d+|${FRACTION_CHAR}))?`
const UNITS =
  "cups?|c\\.|tablespoons?|tbsps?|tbs|teaspoons?|tsps?|pounds?|lbs?|ounces?|oz|grams?|g|" +
  "kilograms?|kg|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|pinch(?:es)?|dash(?:es)?"
const LEADING_AMOUNT = new RegExp(
  `^\\s*${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?\\s*(?:(?:${UNITS})\\b\\.?)?\\s*(?:of\\s+)?`, "i",
)

// What a source adds after the first amount: "+ 1 tbsp" or a second measure, "(97g)".
const LEADING_EXTRA = new RegExp(
  `^\\s*(?:\\+\\s*${NUM}\\s*(?:(?:${UNITS})\\b\\.?)?|\\(\\s*${NUM}\\s*(?:${UNITS})\\b\\.?\\s*\\))\\s*`, "i",
)

/** The name without a leading amount: "1 cup basmati rice" -> "basmati rice". */
export function bareName(name: string): string {
  let rest = name.replace(LEADING_AMOUNT, "").trim()
  for (let more = rest.replace(LEADING_EXTRA, "").trim(); more && more !== rest; more = rest.replace(LEADING_EXTRA, "").trim()) rest = more
  return !/^[a-z(]/i.test(rest) || /^x\b/.test(rest) ? name.trim() : rest
}

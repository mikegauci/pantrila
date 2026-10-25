// --- Temperatures found in step text --------------------------------------------------------
// Display only: the stored recipe keeps the text exactly as the source wrote it.

export type TempUnit = "C" | "F"

// "350°F", "350 °F", "350F", "350 degrees F", "175-180°C", "175 to 180 degrees Celsius"
const TEMP = String.raw`(\d{2,3})(?:(\s*(?:-|–|to)\s*)(\d{2,3}))?(?:\s*[°º˚]\s*|\s+degrees?\s+|)(Fahrenheit|Celsius|F|C)\b`
const FLAGS = "gi"
const SINGLE = new RegExp(String.raw`(?<![\d.])${TEMP}`, FLAGS)
// Sources often give both: "350°F / 180°C", "350°F (180°C)", "180°C or 350°F".
const DUAL = new RegExp(String.raw`(?<![\d.])${TEMP}(\s*/\s*|\s+or\s+|\s*\(\s*)${TEMP}(\s*\))?`, FLAGS)

const unitOf = (word: string): TempUnit => (word[0].toUpperCase() === "F" ? "F" : "C")

/** Oven-style rounding: 350°F -> 180°C, 200°C -> 400°F; small numbers (meat, candy) stay exact. */
export function convertTemp(value: number, to: TempUnit): number {
  if (to === "C") {
    const c = ((value - 32) * 5) / 9
    return c >= 120 ? Math.round(c / 10) * 10 : Math.round(c)
  }
  const f = (value * 9) / 5 + 32
  return f >= 240 ? Math.round(f / 25) * 25 : Math.round(f)
}

// A fan (convection) oven runs hotter, so recipes for a conventional oven drop about 25°F there:
// 350°F (180°C) becomes 325°F (165°C). Only for oven steps that do not name a fan oven already.
const OVEN = /\b(oven|bake[sd]?|baking|roast(?:s|ed|ing)?|preheat)\b/i
const HAS_FAN = /\b(fan|convection|air[\s-]?fry(?:er)?)\b/i
const FAN_DROP_F = 25

/** The fan-oven setting for a conventional `value` in `from`, shown in `to`: 180°C -> 165°C, 350°F -> 325°F. */
export function fanTemp(value: number, from: TempUnit, to: TempUnit): number {
  if (to === "F") return (from === "F" ? value : convertTemp(value, "F")) - FAN_DROP_F
  const f = from === "F" ? value : (value * 9) / 5 + 32
  return Math.round((((f - FAN_DROP_F - 32) * 5) / 9) / 5) * 5
}

const isOvenHeat = (value: number, unit: TempUnit) => (unit === "C" ? value : convertTemp(value, "C")) >= 120

function single(text: string, to: TempUnit): string {
  const fan = OVEN.test(text) && !HAS_FAN.test(text)
  return text.replace(SINGLE, (whole, lo: string, sep: string | undefined, hi: string | undefined, word: string) => {
    const from = unitOf(word)
    const show = (v: string) => (from === to ? Number(v) : convertTemp(Number(v), to))
    const out = from === to ? whole : `${show(lo)}${sep ? `${sep}${show(hi!)}` : ""}°${to}`
    if (!fan || !isOvenHeat(Number(lo), from)) return out
    const fanned = `${fanTemp(Number(lo), from, to)}${sep ? `${sep}${fanTemp(Number(hi), from, to)}` : ""}`
    return `${out} (${fanned}°${to} fan)`
  })
}

/**
 * The step with every temperature shown in `to`; a "350°F (180°C)" pair collapses to one. An oven
 * temperature gets its fan-oven setting in brackets: "180°C (165°C fan)".
 */
export function showTemps(text: string, to: TempUnit): string {
  const paired = text.replace(DUAL, (whole, ...g: (string | undefined)[]) => {
    const [lo1, sep1, hi1, word1, join, lo2, sep2, hi2, word2, close] = g
    const [u1, u2] = [unitOf(word1!), unitOf(word2!)]
    if (u1 === u2 || (join!.includes("(") && !close)) return whole
    const [lo, sep, hi] = u1 === to ? [lo1, sep1, hi1] : [lo2, sep2, hi2]
    return `${lo}${sep ? `${sep}${hi}` : ""}°${to}`
  })
  return single(paired, to)
}

export function hasTemp(texts: string[]): boolean {
  return texts.some((t) => new RegExp(SINGLE.source, "i").test(t))
}

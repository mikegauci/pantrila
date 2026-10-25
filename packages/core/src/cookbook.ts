import type { Allergen, CookbookCard, CookbookDetail, CookbookRecipeIn, RecipeSource, SourcePlatform, Unit } from "./types"

/** The person's own recipes: what the web and phone cookbooks say and check the same way. */

export const SOURCE_TEXT: Record<RecipeSource, string> = {
  photo: "From a photo",
  link: "From a link",
  post: "From social media",
  text: "Pasted text",
  video: "From a video",
  manual: "Typed in",
}

export const PLATFORM: Record<SourcePlatform, string> = {
  tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook",
}

/** A link's site for display: "bbcgoodfood.com". */
export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** "From @creator on TikTok", with whatever parts of the credit are known. */
export function postCredit(r: Pick<CookbookDetail, "source_author" | "source_platform">) {
  const by = r.source_author ? ` @${r.source_author}` : " a post"
  return `From${by}${r.source_platform ? ` on ${PLATFORM[r.source_platform]}` : ""}`
}

const ORIGIN: Record<RecipeSource, string> = {
  post: "social media", link: "links", photo: "photos", video: "videos", text: "pasted text", manual: "typed in",
}

/** "social media 3, links 2, the assistant 1": where the cards came from. Saved assistant drafts count as the assistant. */
export function origins(cards: Pick<CookbookCard, "source" | "chat_draft">[]) {
  const counts = new Map<string, number>()
  for (const r of cards) {
    const key = r.chat_draft ? "the assistant" : ORIGIN[r.source]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([name, n]) => `${name} ${n}`).join(", ")
}

export const UNITS: Unit[] = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "piece", "pinch"]

export const ALLERGENS: Allergen[] = [
  "celery", "gluten", "crustaceans", "eggs", "fish", "lupin", "milk", "molluscs", "mustard",
  "tree_nuts", "peanuts", "sesame", "soy", "sulphites",
]

export const BLANK_RECIPE: CookbookRecipeIn = {
  title: "", summary: "", cuisine: "", meal_types: ["dinner"], total_minutes: 30, servings: 2,
  ingredients: [{ name: "", quantity: 1, unit: "g", food: null, estimate: null }],
  steps: [], source: "manual", source_url: null, source_platform: null, source_author: null,
  recipe_url: null,
}

export const NO_METHOD_STEP = "Add the method here."  // recipe_import.NO_METHOD_STEP

/** An imported draft that cannot be saved as it is: a food left unknown, or no method. */
export const needsReview = (d: CookbookRecipeIn) =>
  d.ingredients.some((l) => !l.food && !l.estimate) || d.steps.includes(NO_METHOD_STEP)

const toKey = (text: string) => text.trim().toLowerCase().replaceAll("-", " ").split(/\s+/).join("_")

/** Words that describe a food's state, not which food it is (mirrors `PREP_WORDS` in pantry.py). */
const PREP_WORDS = new Set([
  "melted", "softened", "chopped", "diced", "sliced", "minced", "grated", "shredded",
  "sifted", "packed", "plain", "unsweetened", "large", "medium", "small",
])
const ALIASES: Record<string, string> = {
  all_purpose_flour: "plain_flour", whole_wheat_flour: "wholemeal_flour",
  wholewheat_flour: "wholemeal_flour", white_chocolate_chips: "white_chocolate",
  chocolate_chips: "dark_chocolate",
}

/** The table food a typed name means, if it is one exactly (or its plural/singular). */
export function matchFood(text: string, keys: Set<string>): string | null {
  const k = toKey(text)
  const bare = k.split("_").filter((w) => !PREP_WORDS.has(w)).join("_")
  for (const n of new Set([k, bare])) {
    for (const c of [n, `${n}s`, n.replace(/es$/, ""), n.replace(/s$/, "")]) {
      if (keys.has(c)) return c
      if (ALIASES[c]) return ALIASES[c]
    }
  }
  return null
}

/** Mirrors `social.detect` on the server: links Pantrila reads as a post's caption. */
export const POST_LINK = new RegExp(
  "^(https?://)?(" +
    "(vm|vt)\\.tiktok\\.com/|((www|m)\\.)?tiktok\\.com/(@[\\w.]+/(video|photo)/\\d|t/)" +
    "|((www|m)\\.)?instagram\\.com/([\\w.]+/)?(p|reels?|tv)/" +
    "|((www|m|web)\\.)?(facebook|fb)\\.com/(?!login|checkpoint|$)|fb\\.watch/" +
  ")",
  "i",
)

export function postPlatform(link: string): SourcePlatform | null {
  if (/tiktok\.com/i.test(link)) return "tiktok"
  if (/instagram\.com/i.test(link)) return "instagram"
  if (/(facebook|fb)\.(com|watch)/i.test(link)) return "facebook"
  return null
}

/** A step an import took ("Reading the caption"); the last one is under way. */
export interface ImportStep {
  key: string
  label: string
}

/** The steps of an import that already ran (done) and the one under way. A step the import
 * comes back to ("Matching ingredients" after the video) moves to the end. */
export function importRows(steps: ImportStep[]): { step: ImportStep; done: boolean }[] {
  if (!steps.length) return [{ step: { key: "start", label: "Starting the import" }, done: false }]
  const current = steps[steps.length - 1]
  const earlier = steps.slice(0, -1).filter((s, i, all) =>
    s.key !== current.key && all.findIndex((o) => o.key === s.key) === i)
  return [...earlier.map((step) => ({ step, done: true })), { step: current, done: false }]
}

/** 75 -> "1:15". */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

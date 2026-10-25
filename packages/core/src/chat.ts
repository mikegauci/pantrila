import type { ChatEvent } from "./api"
import type { ChatReply, CookbookRecipeIn, RecipeCard, ToolCall } from "./types"

/** The assistant chat: how the web and phone apps read a reply the same way. */

export const STARTERS = [
  "What can I cook tonight with what I have?",
  "I just bought eggs, spinach and feta.",
  "Find a quick high-protein breakfast.",
]

/** Adds spoken words to a message, with a space between the parts. */
export function addWords(message: string, heard: string) {
  return [message, heard.trim()].filter(Boolean).join(" ")
}

export type ToolIcon = "search" | "pantry" | "swap" | "scale" | "write" | "other"

/** One line saying what a tool call did ("Searched “tofu”: 3 recipes matched your filters"). */
export function toolSummary(c: ToolCall): { icon: ToolIcon; text: string } {
  const a = c.arguments as Record<string, string | number | null>
  const lines = c.output.split("\n").filter(Boolean)
  switch (c.name) {
    case "search_recipes":
      return { icon: "search", text: c.output === "no recipes match"
        ? `Searched “${a.query}”: nothing passed your filters`
        : `Searched “${a.query}”: ${lines.length} recipe${lines.length === 1 ? "" : "s"} matched your filters` }
    case "check_pantry":
      return { icon: "pantry", text: a.recipe_id ? `Checked your pantry against ${a.recipe_id}` : "Checked your pantry" }
    case "update_pantry":
      return { icon: "pantry", text: `Updated your pantry: ${lines.join("; ")}` }
    case "swap_ingredient":
      return { icon: "swap", text: `Checked swaps for ${a.food} in ${a.recipe_id}` }
    case "scale_recipe":
      return { icon: "scale", text: `Scaled ${a.recipe_id} to ${a.servings} servings` }
    case "write_recipe":
      return { icon: "write", text: `Wrote “${a.title}” and checked it against your rules` }
    default:
      return { icon: "other", text: c.name }
  }
}

/** Words only, lower case, so "**Prawn and Rice:** " and "Prawn and Rice" compare equal. */
function plainTitle(s: string) {
  return s.replace(/\*\*/g, "").replace(/[\s:–—-]+$/, "").trim().toLowerCase()
}

const CITE = /^\[([a-z0-9-]+)\]$/

export type InlinePart =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "cite"; id: string; recipe: RecipeCard | undefined; text: string }

/** A line's parts: plain text, **bold** and [recipe-id] citations. The model often writes a
 * recipe's title just before its citation; the citation shows the title, so that text goes. */
export function inlineParts(text: string, recipes: Map<string, RecipeCard>): InlinePart[] {
  const parts = text.split(/(\[[a-z0-9]+(?:-[a-z0-9]+)*\]|\*\*[^*]+\*\*)/g)
  const out: InlinePart[] = []
  parts.forEach((part, i) => {
    const next = parts[i + 1]?.match(CITE)
    const before = next && recipes.get(next[1])
    if (!part || (before && plainTitle(part) === plainTitle(before.title))) return
    const cite = part.match(CITE)
    if (cite) out.push({ kind: "cite", id: cite[1], recipe: recipes.get(cite[1]), text: part })
    else if (part.startsWith("**") && part.endsWith("**")) out.push({ kind: "bold", text: part.slice(2, -2) })
    else out.push({ kind: "text", text: part })
  })
  return out
}

/**
 * A reply line that only names recipes (a citation, its title and kcal): the recipe cards show it,
 * so the line goes. Lines with any other words stay.
 */
function citesOnly(line: string, recipes: Map<string, RecipeCard>): boolean {
  const cites = line.match(/\[[a-z0-9-]+\]/g)
  if (!cites || !cites.every((c) => recipes.has(c.slice(1, -1)))) return false
  let rest = line.replace(/\*\*/g, "").replace(/\d+\s*kcal/gi, "").toLowerCase()
  for (const c of cites) rest = rest.split(c).join("")
  for (const r of recipes.values()) rest = rest.split(r.title.toLowerCase()).join("")
  return /^[\s·\-–—:,.|]*$/.test(rest)
}

export type Block = { list: boolean; lines: string[] }

/** A reply as paragraphs and bulleted lists; blank lines and lines that only cite recipes go. */
export function chatBlocks(text: string, recipes: Map<string, RecipeCard>): Block[] {
  const blocks: Block[] = []
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
    const trimmed = line.trim()
    if (!trimmed || citesOnly(trimmed, recipes)) continue
    const last = blocks.at(-1)
    if (item) {
      if (last?.list) last.lines.push(item[1])
      else blocks.push({ list: true, lines: [item[1]] })
    } else if (last && !last.list) {
      last.lines.push(trimmed)
    } else {
      blocks.push({ list: false, lines: [trimmed] })
    }
  }
  return blocks
}

/** A markdown heading line ("#### Ingredients") as its words, else null. */
export function headingOf(line: string): string | null {
  const heading = line.match(/^#{1,6}\s+(.*)$/)
  return heading ? heading[1].replace(/\*\*/g, "") : null
}

/** Recipes a reply uses, each with the servings it gave: cited in the text, or scaled by a tool. */
export function usedRecipes(reply: ChatReply | null | undefined): Map<string, number | undefined> {
  const used = new Map<string, number | undefined>()
  for (const c of reply?.tool_calls ?? []) {
    if (c.name === "scale_recipe") used.set(String(c.arguments.recipe_id), Number(c.arguments.servings))
  }
  for (const c of reply?.cited ?? []) if (!used.has(c.id)) used.set(c.id, undefined)
  return used
}

/**
 * Which draft of which chat a saved recipe came from: the thread and a hash of the draft as the
 * assistant wrote it, so a changed version written later in the chat counts as a new draft.
 */
export function draftTag(thread: number | null, d: CookbookRecipeIn): string | null {
  if (!thread) return null
  let h = 0x811c9dc5  // FNV-1a, 32 bits; the tag itself is left out
  for (const ch of JSON.stringify({ ...d, chat_draft: undefined })) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${thread}:${h.toString(16).padStart(8, "0")}`
}

/** The reply in flight: what the assistant is doing, its text so far and the recipes it found. */
export interface LiveReply {
  label: string
  text: string
  cards: Map<string, RecipeCard>
}

export const startReply = (): LiveReply => ({ label: "Thinking…", text: "", cards: new Map() })

/** The reply in flight after one streamed event. A new step after some text means that text led
 * into a tool call; the reply comes after it. */
export function withEvent(l: LiveReply, e: ChatEvent): LiveReply {
  if (e.kind === "step") return { ...l, label: e.label, text: "" }
  if (e.kind === "delta") return { ...l, text: l.text + e.text }
  return { ...l, cards: new Map([...l.cards, ...e.cards.map((c) => [c.id, c] as const)]) }
}

import { describe, expect, it } from "vitest"

import {
  addWords, chatBlocks, draftTag, headingOf, inlineParts, startReply, toolSummary, usedRecipes, withEvent,
} from "../src/chat"
import { BLANK_RECIPE } from "../src/cookbook"
import type { ChatReply, RecipeCard } from "../src/types"

const card = (id: string, title: string) => ({ id, title, nutrition: { kcal: 420 }, problems: [] }) as unknown as RecipeCard

describe("chat", () => {
  it("reads citations and bold, dropping a title written before its citation", () => {
    const recipes = new Map([["tofu-bowl", card("tofu-bowl", "Tofu Bowl")]])
    expect(inlineParts("Tofu Bowl: [tofu-bowl] is **quick**", recipes)).toEqual([
      { kind: "cite", id: "tofu-bowl", recipe: recipes.get("tofu-bowl"), text: "[tofu-bowl]" },
      { kind: "text", text: " is " },
      { kind: "bold", text: "quick" },
    ])
    expect(inlineParts("[made-up]", recipes)).toEqual([{ kind: "cite", id: "made-up", recipe: undefined, text: "[made-up]" }])
  })

  it("splits a reply into paragraphs and lists, leaving out lines that only cite", () => {
    const recipes = new Map([["tofu-bowl", card("tofu-bowl", "Tofu Bowl")]])
    const text = "#### Ideas\nHere are two.\n\n- One\n- Two\n**Tofu Bowl** [tofu-bowl] · 420 kcal\nEnjoy!"
    expect(chatBlocks(text, recipes)).toEqual([
      { list: false, lines: ["#### Ideas", "Here are two."] },
      { list: true, lines: ["One", "Two"] },
      { list: false, lines: ["Enjoy!"] },
    ])
    expect(headingOf("#### **Ideas**")).toBe("Ideas")
    expect(headingOf("Ideas")).toBeNull()
  })

  it("lists the recipes a reply uses with the servings it scaled to", () => {
    const reply = {
      cited: [card("a", "A"), card("b", "B")],
      tool_calls: [{ name: "scale_recipe", arguments: { recipe_id: "b", servings: 6 }, output: "" }],
    } as unknown as ChatReply
    expect([...usedRecipes(reply)]).toEqual([["b", 6], ["a", undefined]])
    expect(toolSummary({ name: "search_recipes", arguments: { query: "tofu" }, output: "a\nb" }))
      .toEqual({ icon: "search", text: "Searched “tofu”: 2 recipes matched your filters" })
  })

  it("tags a draft by thread and content", () => {
    const d = { ...BLANK_RECIPE, title: "Soup" }
    expect(draftTag(null, d)).toBeNull()
    expect(draftTag(3, d)).toMatch(/^3:[0-9a-f]{8}$/)
    expect(draftTag(3, { ...d, chat_draft: "x" })).toBe(draftTag(3, d))
    expect(draftTag(3, { ...d, title: "Stew" })).not.toBe(draftTag(3, d))
  })

  it("builds the reply in flight from streamed events", () => {
    let l = withEvent(startReply(), { kind: "delta", text: "Let me look" })
    l = withEvent(l, { kind: "step", label: "Searching recipes" })
    l = withEvent(l, { kind: "recipes", cards: [card("a", "A")] })
    l = withEvent(withEvent(l, { kind: "delta", text: "Try " }), { kind: "delta", text: "[a]" })
    expect(l.label).toBe("Searching recipes")
    expect(l.text).toBe("Try [a]")
    expect([...l.cards.keys()]).toEqual(["a"])
    expect(addWords("Find", " a soup ")).toBe("Find a soup")
  })
})

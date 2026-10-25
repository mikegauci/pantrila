import { describe, expect, it } from "vitest"

import {
  BLANK_RECIPE, clock, importRows, matchFood, needsReview, NO_METHOD_STEP, origins, POST_LINK, postCredit,
  postPlatform, siteOf,
} from "../src/cookbook"

describe("cookbook", () => {
  it("matches typed names to table foods", () => {
    const keys = new Set(["red_onion", "egg", "plain_flour", "tomato"])
    expect(matchFood("Red onion", keys)).toBe("red_onion")
    expect(matchFood("eggs", keys)).toBe("egg")
    expect(matchFood("tomatoes", keys)).toBe("tomato")
    expect(matchFood("all-purpose flour", keys)).toBe("plain_flour")
    expect(matchFood("chopped tomato", keys)).toBe("tomato")
    expect(matchFood("saffron", keys)).toBeNull()
  })

  it("asks for a review only when a food is unknown or the method is missing", () => {
    const line = { name: "egg", quantity: 1, unit: "piece" as const, food: "egg", estimate: null }
    expect(needsReview({ ...BLANK_RECIPE, ingredients: [line], steps: ["Boil."] })).toBe(false)
    expect(needsReview({ ...BLANK_RECIPE, ingredients: [{ ...line, food: null }], steps: ["Boil."] })).toBe(true)
    expect(needsReview({ ...BLANK_RECIPE, ingredients: [line], steps: [NO_METHOD_STEP] })).toBe(true)
  })

  it("credits posts and names sites", () => {
    expect(postCredit({ source_author: "chelsea", source_platform: "tiktok" })).toBe("From @chelsea on TikTok")
    expect(postCredit({ source_author: null, source_platform: null })).toBe("From a post")
    expect(siteOf("https://www.bbcgoodfood.com/recipes/x")).toBe("bbcgoodfood.com")
    expect(siteOf("not a url")).toBe("not a url")
  })

  it("counts where recipes came from", () => {
    expect(origins([
      { source: "post", chat_draft: null }, { source: "post", chat_draft: null },
      { source: "manual", chat_draft: "3:abc" }, { source: "link", chat_draft: null },
    ])).toBe("social media 2, the assistant 1, links 1")
  })

  it("tells post links from recipe pages", () => {
    expect(POST_LINK.test("https://www.instagram.com/reel/abc/")).toBe(true)
    expect(POST_LINK.test("https://vm.tiktok.com/xyz/")).toBe(true)
    expect(POST_LINK.test("https://www.bbcgoodfood.com/recipes/x")).toBe(false)
    expect(postPlatform("https://fb.watch/abc")).toBe("facebook")
  })

  it("lists import steps with repeats moved to the end", () => {
    expect(importRows([])).toEqual([{ step: { key: "start", label: "Starting the import" }, done: false }])
    const steps = [
      { key: "post", label: "Reading the post" }, { key: "ingredients", label: "Matching ingredients" },
      { key: "video", label: "Watching the video" }, { key: "ingredients", label: "Matching ingredients" },
    ]
    expect(importRows(steps).map((r) => [r.step.key, r.done])).toEqual([
      ["post", true], ["video", true], ["ingredients", false],
    ])
    expect(clock(75)).toBe("1:15")
  })
})

import { label } from "./format"
import type { GroceryItem } from "./types"

const AISLES: Record<string, string> = { nuts_seeds: "Nuts and seeds", oils_condiments: "Oils and condiments" }

/** An aisle's name as the grocery list shows it. */
export const aisleName = (aisle: string) => AISLES[aisle] ?? label(aisle)

/** The list's items in runs of one aisle each, in the order the API sends them. */
export function byAisle(items: GroceryItem[]): [string, GroceryItem[]][] {
  const groups: [string, GroceryItem[]][] = []
  for (const i of items) {
    const last = groups.at(-1)
    if (last && last[0] === i.aisle) last[1].push(i)
    else groups.push([i.aisle, [i]])
  }
  return groups
}

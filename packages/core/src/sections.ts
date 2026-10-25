import type { StepSection } from "./types"

export interface Group<T> {
  /** The source's heading ("For the sauce"); empty when the list is not grouped. */
  title: string
  /** Items with their position in the whole list. */
  items: { item: T; index: number }[]
}

/** Consecutive items that share a `section` (ingredient lines). */
export function groupLines<T extends { section?: string }>(items: T[]): Group<T>[] {
  const groups: Group<T>[] = []
  items.forEach((item, index) => {
    const title = item.section ?? ""
    const last = groups.at(-1)
    if (last && last.title === title) last.items.push({ item, index })
    else groups.push({ title, items: [{ item, index }] })
  })
  return groups
}

/** The method's steps split under their headings; steps before the first heading have none. */
export function groupSteps(steps: string[], sections: StepSection[] = []): Group<string>[] {
  const starts = new Map(sections.map((s) => [s.first_step, s.title]))
  const groups: Group<string>[] = []
  steps.forEach((item, index) => {
    const title = starts.get(index + 1)
    if (title !== undefined || groups.length === 0) groups.push({ title: title ?? "", items: [] })
    groups.at(-1)!.items.push({ item, index })
  })
  return groups
}

/** The heading that applies at step number `step` (1-based), or "". */
export function stepHeading(sections: StepSection[] = [], step: number): string {
  let title = ""
  for (const s of sections) if (s.first_step <= step) title = s.title
  return title
}

const HEADING = /^#{1,6}\s*(.*)$/

/** The method as the form edits it: one step per paragraph, a `## Heading` line before the first
 *  step under each heading. */
export function stepsToText(steps: string[], sections: StepSection[] = []): string {
  return groupSteps(steps, sections)
    .flatMap((g) => [...(g.title ? [`## ${g.title}`] : []), ...g.items.map((s) => s.item)])
    .join("\n\n")
}

/** Inverse of `stepsToText`. A heading with no step after it is dropped. */
export function textToSteps(text: string): { steps: string[]; step_sections: StepSection[] } {
  const steps: string[] = []
  const found = new Map<number, string>()
  let pending = ""
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const heading = HEADING.exec(line)
    if (heading) {
      pending = heading[1].trim()
      continue
    }
    steps.push(line)
    if (pending) found.set(steps.length, pending.slice(0, 80))
    pending = ""
  }
  const step_sections = [...found].slice(0, 20).map(([first_step, title]) => ({ title, first_step }))
  return { steps, step_sections }
}

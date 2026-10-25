import { describe, expect, it } from "vitest"

import { EventParser, readEvents } from "../src/sse"

const stream = (pieces: string[]) => {
  const bytes = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      pieces.forEach((p) => c.enqueue(bytes.encode(p)))
      c.close()
    },
  })
}

describe("EventParser", () => {
  it("joins events split across pieces and skips keep-alives", () => {
    const parser = new EventParser()
    expect(parser.push('event: step\ndata: {"lab')).toEqual([])
    expect(parser.push('el":"Searching"}\n\n\n\nevent: plan\ndata: {"id":1}\n\n')).toEqual([
      { event: "step", data: { label: "Searching" } },
      { event: "plan", data: { id: 1 } },
    ])
  })
})

describe("readEvents", () => {
  it("reports each event and whether a terminal one arrived", async () => {
    const seen: string[] = []
    // "é" split across two byte chunks still decodes.
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const b = new TextEncoder().encode('event: delta\ndata: {"text":"café"}\n\nevent: reply\ndata: {}\n\n')
        const cut = b.indexOf(0xc3) + 1
        c.enqueue(b.slice(0, cut))
        c.enqueue(b.slice(cut))
        c.close()
      },
    })
    expect(await readEvents(body, ["reply"], (e, d) => seen.push(`${e}:${JSON.stringify(d)}`))).toBe(true)
    expect(seen).toEqual(['delta:{"text":"café"}', "reply:{}"])
  })

  it("is false when the stream ends early", async () => {
    expect(await readEvents(stream(['event: step\ndata: {"label":"x"}\n\n']), ["plan"], () => {})).toBe(false)
  })
})

/** Server-sent events as the API writes them: `event: name` and `data: json` lines, a blank line
 * after each event. Used by POST /plans and POST /chat/stream. */

export interface ServerEvent {
  event: string
  data: unknown
}

/** Splits text that arrives in pieces into events; feed it every piece in order. */
export class EventParser {
  private buffer = ""

  /** The events completed by this piece of text. */
  push(text: string): ServerEvent[] {
    this.buffer += text
    const out: ServerEvent[] = []
    let end
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const block = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 2)
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7)
        else if (line.startsWith("data: ")) data += line.slice(6)
      }
      // A bare blank block (a keep-alive) is no event.
      if (data || event !== "message") out.push({ event, data: data ? JSON.parse(data) : null })
    }
    return out
  }
}

/** Read a response body as server-sent events, calling `onEvent` for each one; true once one of
 * the `terminal` events arrived. Works with any fetch whose body is a ReadableStream (browsers,
 * `expo/fetch`). */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  terminal: string[],
  onEvent: (event: string, data: unknown) => void,
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new EventParser()
  let ended = false
  const deliver = (text: string) => {
    for (const { event, data } of parser.push(text)) {
      if (terminal.includes(event)) ended = true
      onEvent(event, data)
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    deliver(decoder.decode(value, { stream: true }))
  }
  deliver(decoder.decode())
  return ended
}

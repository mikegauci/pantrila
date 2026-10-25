import { describe, expect, it } from "vitest"

import { micHelp, voiceCommand } from "../src/voice"

describe("voiceCommand", () => {
  it("maps phrases to commands", () => {
    expect(voiceCommand("go to the next step")).toBe("next")
    expect(voiceCommand("no, go back")).toBe("back")
    expect(voiceCommand("start the timer")).toBe("start-timer")
    expect(voiceCommand("stop the timer")).toBe("stop-timer")
    expect(voiceCommand("Stop!")).toBe("stop-timer")
    expect(voiceCommand("start cooking")).toBe("start")
    expect(voiceCommand("what a lovely smell")).toBeNull()
  })
})

describe("micHelp", () => {
  it("gives steps for the browser in use", () => {
    expect(micHelp("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari").where).toBe("Safari on iPhone or iPad")
    expect(micHelp("Mozilla/5.0 (iPhone) CriOS/130").where).toBe("Chrome on iPhone or iPad")
    expect(micHelp("Mozilla/5.0 (Macintosh) AppleWebKit Safari", true).where).toBe("Safari on iPhone or iPad")
    expect(micHelp("Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari").where).toBe("Chrome on Android")
    expect(micHelp("Mozilla/5.0 (Macintosh) AppleWebKit Version/18 Safari").where).toBe("Safari on Mac")
    expect(micHelp("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari Edg/130").where).toBe("Edge")
  })
})

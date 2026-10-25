/** Voice commands in cooking mode, by words alone: any app maps what its speech recognition heard
 * with `voiceCommand`. */

// --- Commands -------------------------------------------------------------------------------

// "start" ("start cooking") only acts on the get-ready page, so it is not in the commands list.
export type VoiceCommand = "next" | "back" | "start" | "start-timer" | "stop-timer"

/** What each command does, for the commands list and the tour. */
export const VOICE_COMMANDS: { say: string; does: string }[] = [
  { say: "Next", does: "Go to the next step" },
  { say: "Back", does: "Go to the previous step" },
  { say: "Start timer", does: "Start this step's timer, or resume a paused one" },
  { say: "Stop timer", does: "Silence a finished timer, or pause the running one" },
]

const NEXT = new Set(["next", "forward", "continue"])
const BACK = new Set(["back", "previous", "backward", "backwards"])
const STOP = new Set(["stop", "pause", "cancel", "silence", "quiet", "off", "end", "enough", "dismiss"])

/** The command in one heard phrase, or null. Words, not the platform, decide, so a native app can
 * reuse this with its own speech recognition: "go to the next step" -> next, "stop" -> stop-timer. */
export function voiceCommand(heard: string): VoiceCommand | null {
  const words = heard.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
  // "start the timer", "set a timer", "resume timer"; any stop word makes it a stop.
  if (words.some((w) => w === "timer" || w === "timers" || w === "alarm")) {
    return words.some((w) => STOP.has(w)) ? "stop-timer" : "start-timer"
  }
  // The last command word wins: "no, go back" is back.
  for (let i = words.length - 1; i >= 0; i--) {
    if (NEXT.has(words[i])) return "next"
    if (BACK.has(words[i])) return "back"
    if (words[i] === "stop" || words[i] === "pause" || words[i] === "silence") return "stop-timer"
  }
  if (words.some((w) => w === "start" || w === "begin" || w === "cook" || w === "cooking")) return "start"
  return null
}

// --- Microphone help ------------------------------------------------------------------------

/** How to unblock the microphone in this browser, as steps for the person to follow. `touch`: an
 * iPad's Safari says "Macintosh", so a Mac with a touch screen is taken to be an iPad. */
export function micHelp(ua: string, touch = false): { where: string; steps: string[] } {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch)
  if (ios) {
    const app = /CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS/.test(ua) ? "Edge" : null
    const dictation = "If it still says blocked, turn on Settings > General > Keyboard > Enable Dictation (it is needed to recognise speech)."
    if (app) {
      return {
        where: `${app} on iPhone or iPad`,
        steps: [`Open the Settings app, then Apps > ${app}, and turn on Microphone.`,
          `Come back to ${app}, reload this page and tap the mic.`, dictation],
      }
    }
    return {
      where: "Safari on iPhone or iPad",
      steps: ["Tap aA at the left of the address bar, then Website Settings.", "Set Microphone to Allow.",
        "Reload this page and tap the mic.",
        "Microphone not listed? In the Settings app, open Apps > Safari > Microphone and choose Ask or Allow.",
        dictation],
    }
  }
  if (/Android/.test(ua)) {
    return {
      where: "Chrome on Android",
      steps: ["Tap the icon at the left of the address bar, then Permissions.", "Set Microphone to Allow.",
        "Reload this page and tap the mic.",
        "Still blocked? In the phone's Settings, open Apps > Chrome > Permissions > Microphone and choose Allow."],
    }
  }
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return {
      where: "Safari on Mac",
      steps: ["In the menu bar, open Safari > Settings > Websites > Microphone.",
        "Set this site to Allow.", "Reload this page and tap the mic."],
    }
  }
  const app = /Edg\//.test(ua) ? "Edge" : "Chrome"
  return {
    where: app,
    steps: ["Click the icon at the left of the address bar.", "Turn on Microphone (or set it to Allow).",
      "Reload this page and click the mic.",
      `On a Mac, also check System Settings > Privacy & Security > Microphone allows ${app}.`],
  }
}

// --- Listening ------------------------------------------------------------------------------

/** One way of hearing phrases: the browser here, a native speech module in an app later. */
export interface VoiceListener {
  start(): void
  stop(): void
}

export type VoiceError = "denied" | "failed"

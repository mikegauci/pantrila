import AsyncStorage from "@react-native-async-storage/async-storage"
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio"
import { Vibration } from "react-native"

import type { CookProgress } from "@pantrila/core/cooking"

// --- Progress kept on the phone -------------------------------------------------------------

const KEEP_MS = 12 * 3600 * 1000

/** Progress saved under `progressKey` (the web's key shape) in the last 12 hours, else null. */
export async function loadProgress(key: string): Promise<CookProgress | null> {
  try {
    const p = JSON.parse((await AsyncStorage.getItem(key)) ?? "null") as CookProgress | null
    return p && Date.now() - p.savedAt < KEEP_MS ? p : null
  } catch {
    return null
  }
}

export async function saveProgress(key: string, p: Omit<CookProgress, "savedAt"> | null): Promise<void> {
  try {
    if (p) await AsyncStorage.setItem(key, JSON.stringify({ ...p, savedAt: Date.now() }))
    else await AsyncStorage.removeItem(key)
  } catch {}
}

// --- Sounds (scripts/cooking_sounds.py writes them: the web's notes) ------------------------

let players: { ring: AudioPlayer; chime: AudioPlayer } | null = null

function sounds() {
  if (!players) {
    // Ring with the phone on silent too: a timer the cook cannot hear is no use.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
    players = {
      ring: createAudioPlayer(require("../../assets/sounds/ring.wav")),
      chime: createAudioPlayer(require("../../assets/sounds/chime.wav")),
    }
  }
  return players
}

function play(player: AudioPlayer) {
  try {
    player.seekTo(0)
    player.play()
  } catch {}
}

/** Three short beeps and a vibration: a timer is done. */
export function ring() {
  Vibration.vibrate([0, 300, 150, 300, 150, 300])
  play(sounds().ring)
}

/** One soft rising note: a voice command was heard. */
export function chime() {
  play(sounds().chime)
}

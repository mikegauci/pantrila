import { ExpoSpeechRecognitionModule } from "expo-speech-recognition"
import { useEffect, useRef, useState } from "react"
import { AppState, Platform } from "react-native"

import { voiceCommand, type VoiceCommand, type VoiceError, type VoiceListener } from "@pantrila/core/voice"

/** Speech recognition on the phone, behind core's `VoiceListener`: what it hears goes through
 * core's `voiceCommand`, as on the web. */

/** False where the phone cannot recognise speech (Siri and Dictation off, no Google speech service). */
export function voiceSupported(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable()
  } catch {
    return false
  }
}

/** Whether speech stays on the phone; when it cannot, the privacy notice names who hears it. */
export function onDevice(): boolean {
  try {
    return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
  } catch {
    return false
  }
}

export const speechService = () => (Platform.OS === "ios" ? "Apple" : "Google")

/** Ask for the microphone and speech recognition; false when the person (or the phone) said no. */
export async function allowVoice(): Promise<boolean> {
  try {
    const now = await ExpoSpeechRecognitionModule.getPermissionsAsync()
    if (now.granted) return true
    return (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted
  } catch {
    return false
  }
}

/** Listens until `stop`. iOS ends a session after each phrase, so it starts again; Android keeps
 * one continuous session (each restart there beeps). Ending five times within a second each
 * means it cannot listen, so it gives up instead of looping. */
export function phoneListener(onHeard: (text: string) => void, onError: (e: VoiceError) => void): VoiceListener {
  let on = false
  let quickEnds = 0
  let startedAt = 0
  let subs: { remove(): void }[] = []

  const begin = () => {
    startedAt = Date.now()
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: false,
      maxAlternatives: 1,
      continuous: Platform.OS === "android",
      requiresOnDeviceRecognition: onDevice(),
      contextualStrings: ["next", "back", "start timer", "stop timer", "start cooking"],
      iosCategory: { category: "playAndRecord", categoryOptions: ["defaultToSpeaker", "allowBluetooth"], mode: "measurement" },
    })
  }

  const stopAll = () => {
    subs.forEach((s) => s.remove())
    subs = []
  }

  return {
    start() {
      if (on) return
      on = true
      quickEnds = 0
      subs = [
        ExpoSpeechRecognitionModule.addListener("result", (e) => {
          if (e.isFinal) onHeard(e.results[0]?.transcript ?? "")
        }),
        ExpoSpeechRecognitionModule.addListener("error", (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            on = false
            stopAll()
            onError("denied")
          }
        }),
        ExpoSpeechRecognitionModule.addListener("end", () => {
          if (!on) return
          quickEnds = Date.now() - startedAt < 1000 ? quickEnds + 1 : 0
          if (quickEnds >= 5) {
            on = false
            stopAll()
            onError("failed")
            return
          }
          try {
            begin()
          } catch {
            on = false
            stopAll()
            onError("failed")
          }
        }),
      ]
      try {
        begin()
      } catch {
        on = false
        stopAll()
        onError("failed")
      }
    },
    stop() {
      on = false
      stopAll()
      try {
        ExpoSpeechRecognitionModule.abort()
      } catch {}
    },
  }
}

/** Listen while `enabled` and the app is on screen (a locked phone stops it; unlocking resumes). */
export function useVoiceCommands(
  enabled: boolean,
  onCommand: (c: VoiceCommand) => void,
  onError: (e: VoiceError) => void,
): boolean {
  const [listening, setListening] = useState(false)
  const handlers = useRef({ onCommand, onError })
  useEffect(() => { handlers.current = { onCommand, onError } }, [onCommand, onError])

  useEffect(() => {
    if (!enabled) return
    const listener = phoneListener(
      (text) => {
        const c = voiceCommand(text)
        if (c) handlers.current.onCommand(c)
      },
      (e) => {
        setListening(false)
        handlers.current.onError(e)
      },
    )
    // "background" is a locked phone or another app; anything else (including "unknown" while the
    // app starts) keeps listening.
    const sync = (state: string) => {
      if (state !== "background") {
        listener.start()
        setListening(true)
      } else {
        listener.stop()
        setListening(false)
      }
    }
    sync(AppState.currentState ?? "unknown")
    const sub = AppState.addEventListener("change", sync)
    return () => {
      sub.remove()
      listener.stop()
      setListening(false)
    }
  }, [enabled])

  return enabled && listening
}

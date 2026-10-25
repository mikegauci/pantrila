import { Mic, MicOff } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { AppState, Pressable } from "react-native"

import { Icon } from "@/components/icon"
import { toast } from "@/lib/toast"
import { allowVoice, phoneListener, voiceSupported } from "@/lib/voice"

/** Mic beside Send: what the person says is typed into the message box (the web's DictateButton).
 * Hidden where the phone cannot recognise speech. Listening stops on a second tap, when the app
 * goes to the background or on leaving. */
export function DictateButton({ onHeard }: { onHeard: (words: string) => void }) {
  const [supported] = useState(voiceSupported)
  const [on, setOn] = useState(false)
  const heard = useRef(onHeard)
  useEffect(() => { heard.current = onHeard }, [onHeard])

  useEffect(() => {
    if (!on) return
    const listener = phoneListener(
      (text) => {
        if (text.trim()) heard.current(text)
      },
      (e) => {
        setOn(false)
        toast.error(e === "denied"
          ? "The microphone is blocked. Allow it for Pantrila in Settings, then tap the mic again."
          : "Dictation stopped. Tap the mic to try again.")
      },
      [],
    )
    listener.start()
    const sub = AppState.addEventListener("change", (state) => { if (state === "background") setOn(false) })
    return () => {
      sub.remove()
      listener.stop()
    }
  }, [on])

  if (!supported) return null

  async function toggle() {
    if (on) return setOn(false)
    if (await allowVoice()) setOn(true)
    else toast.error("The microphone is blocked. Allow it for Pantrila in Settings, then tap the mic again.")
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={on ? "Stop dictating" : "Dictate message"}
               accessibilityState={{ selected: on }} onPress={toggle}
               className={`size-11 items-center justify-center rounded-xl ${on ? "bg-primary" : "border border-border bg-surface"}`}>
      <Icon icon={on ? MicOff : Mic} tone={on ? "primary-foreground" : "foreground"} size={18} />
    </Pressable>
  )
}

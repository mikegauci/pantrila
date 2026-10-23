"use client"

import { Mic, MicOff } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { browserListener, useVoiceSupported } from "@/lib/voice"

/** Adds spoken words to a message, with a space between the parts. */
export function addWords(message: string, heard: string) {
  return [message, heard.trim()].filter(Boolean).join(" ")
}

/** Mic beside Send: what the person says is typed into the message box. Hidden where the browser
 * cannot recognise speech. Listening stops on a second tap, when the page is hidden or on leaving. */
export function DictateButton({ onHeard }: { onHeard: (words: string) => void }) {
  const supported = useVoiceSupported()
  const [on, setOn] = useState(false)
  const heard = useRef(onHeard)
  useEffect(() => { heard.current = onHeard }, [onHeard])

  useEffect(() => {
    if (!on) return
    const listener = browserListener(
      (text) => {
        if (text.trim()) heard.current(text)
      },
      (e) => {
        setOn(false)
        toast.error(
          e === "denied"
            ? "The microphone is blocked. Allow it in your browser settings, then tap the mic again."
            : "Dictation stopped. Tap the mic to try again.",
        )
      },
    )
    if (!listener) return
    listener.start()
    const hide = () => {
      if (document.visibilityState === "hidden") setOn(false)
    }
    document.addEventListener("visibilitychange", hide)
    return () => {
      document.removeEventListener("visibilitychange", hide)
      listener.stop()
    }
  }, [on])

  if (!supported) return null

  const label = on ? "Stop dictating" : "Dictate message"
  return (
    <Button
      type="button"
      variant={on ? "default" : "outline"}
      size="icon"
      className="size-11 shrink-0"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={() => setOn(!on)}
    >
      {on ? <MicOff /> : <Mic />}
    </Button>
  )
}

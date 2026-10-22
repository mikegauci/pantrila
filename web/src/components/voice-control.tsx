"use client"

import { Popover } from "@base-ui/react/popover"
import { CircleHelp, Mic, MicOff, X } from "lucide-react"
import { useCallback, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  VOICE_COMMANDS, useVoiceCommands, useVoiceSupported, type VoiceCommand, type VoiceError,
} from "@/lib/voice"

const ON_KEY = "pantrila-voice"
const OK_KEY = "pantrila-voice-ok"
const TIP_KEY = "pantrila-voice-tip-done"

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

/** Mic switch, commands list and first-run tip for cooking mode. Hidden where the browser cannot
 * recognise speech. Rendered on the client only (cooking mode waits for sign-in). */
export function VoiceControl({ onCommand }: { onCommand: (c: VoiceCommand) => void }) {
  const supported = useVoiceSupported()
  const [enabled, setEnabled] = useState(() => read(ON_KEY) === "on" && read(OK_KEY) === "1")
  const [notice, setNotice] = useState(false)
  const [tip, setTip] = useState(() => read(TIP_KEY) === null)

  const turn = useCallback((on: boolean) => {
    setEnabled(on)
    write(ON_KEY, on ? "on" : null)
  }, [])

  const onError = useCallback((e: VoiceError) => {
    turn(false)
    if (e === "denied") toast.error("The microphone is blocked. Allow it for this site to use voice commands.")
    else toast.error("Voice commands stopped. Tap the mic to try again.")
  }, [turn])

  const listening = useVoiceCommands(enabled, onCommand, onError)

  const closeTip = () => {
    setTip(false)
    write(TIP_KEY, "1")
  }

  if (!supported) return null

  const label = enabled ? "Turn off voice commands" : "Turn on voice commands"
  return (
    <span className="relative flex shrink-0 items-center">
      <Button
        variant={enabled ? "default" : "ghost"}
        size="icon"
        aria-label={label}
        aria-pressed={enabled}
        data-tour="voice-mic"
        title={label}
        className="relative"
        onClick={() => {
          closeTip()
          if (enabled) turn(false)
          else if (read(OK_KEY) === "1") turn(true)
          else setNotice(true)
        }}
      >
        {enabled ? <Mic /> : <MicOff />}
        {listening && (
          <span className="absolute top-1 right-1 size-2 rounded-full bg-orange motion-safe:animate-pulse" aria-hidden />
        )}
      </Button>
      <Popover.Root>
        <Popover.Trigger render={<Button variant="ghost" size="icon-sm" aria-label="Voice command list" />}>
          <CircleHelp />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50">
            <Popover.Popup className="w-[min(20rem,calc(100vw-32px))] rounded-xl border bg-surface p-4 text-[14px] shadow-lg outline-none">
              <p className="mb-1 font-semibold">Voice commands</p>
              <p className="mb-3 text-[13px] text-muted-foreground">Tap the mic, then say:</p>
              <CommandList />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {tip && !enabled && (
        <span role="status" className="absolute top-full right-0 z-50 mt-2 flex w-[260px] items-start gap-2 rounded-lg bg-foreground py-2 pr-1 pl-3 text-[13px] leading-5 text-background shadow-lg">
          <span>
            <span className="font-semibold">Cook hands-free.</span> Tap the mic, then say &ldquo;next&rdquo;,
            &ldquo;back&rdquo;, &ldquo;start timer&rdquo; or &ldquo;stop timer&rdquo;.
          </span>
          <button type="button" aria-label="Close tip" onClick={closeTip}
                  className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-background/15">
            <X className="size-4" aria-hidden />
          </button>
        </span>
      )}

      <Sheet open={notice} onOpenChange={setNotice}>
        <SheetContent side="bottom" className="gap-3 rounded-t-[20px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="p-0">
            <SheetTitle>Turn on voice commands?</SheetTitle>
            <SheetDescription>
              While the mic is on, your browser sends what you say to Google or Apple to recognise the words.
              Pantrila only reacts to the commands below and never records or stores your voice. Listening
              stops when you leave cooking mode or lock your phone.
            </SheetDescription>
          </SheetHeader>
          <CommandList />
          <div className="flex gap-2 pt-1">
            <Button size="lg" className="flex-1" onClick={() => {
              write(OK_KEY, "1")
              setNotice(false)
              turn(true)
            }}>
              <Mic /> Turn on
            </Button>
            <Button size="lg" variant="outline" onClick={() => setNotice(false)}>Not now</Button>
          </div>
        </SheetContent>
      </Sheet>
    </span>
  )
}

function CommandList() {
  return (
    <ul className="grid gap-2">
      {VOICE_COMMANDS.map((c) => (
        <li key={c.say} className="flex items-baseline gap-3">
          <span className="shrink-0 rounded-lg bg-primary-soft px-2 py-0.5 text-[13px] font-semibold text-primary-text">
            &ldquo;{c.say}&rdquo;
          </span>
          <span className="text-[13px] text-muted-foreground">{c.does}</span>
        </li>
      ))}
    </ul>
  )
}

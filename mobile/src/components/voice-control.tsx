import { CircleHelp, Mic, MicOff, X } from "lucide-react-native"
import { useCallback, useState } from "react"
import { Linking, Platform, Pressable, Text, View } from "react-native"

import { VOICE_COMMANDS, type VoiceCommand, type VoiceError } from "@pantrila/core/voice"

import { Icon } from "@/components/icon"
import { Sheet } from "@/components/sheet"
import { useStored } from "@/lib/stored"
import { toast } from "@/lib/toast"
import { allowVoice, onDevice, speechService, useVoiceCommands, voiceSupported } from "@/lib/voice"

/** Mic switch, commands list and first-run tip for cooking mode (the web's `VoiceControl`).
 * Hidden where the phone cannot recognise speech. */
export function VoiceControl({ onCommand }: { onCommand: (c: VoiceCommand) => void }) {
  const [supported] = useState(voiceSupported)
  const [on, setOn] = useStored("voice")
  const [ok, setOk] = useStored("voice-ok")
  const [tipDone, setTipDone] = useStored("voice-tip-done")
  const [notice, setNotice] = useState(false)
  const [help, setHelp] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const enabled = on === "on" && ok === "1"

  const turn = useCallback(async (next: boolean) => {
    if (next && !(await allowVoice())) {
      setOn(null)
      setBlocked(true)
      return
    }
    setOn(next ? "on" : null)
  }, [setOn])

  const onError = useCallback((e: VoiceError) => {
    setOn(null)
    if (e === "denied") setBlocked(true)
    else toast.error("Voice commands stopped. Tap the mic to try again.")
  }, [setOn])

  const listening = useVoiceCommands(enabled, onCommand, onError)
  if (!supported) return null

  const private_ = onDevice()
  const label = enabled ? "Turn off voice commands" : "Turn on voice commands"
  return (
    <View className="flex-row items-center">
      <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: enabled }}
                 onPress={() => {
                   setTipDone("1")
                   if (enabled) turn(false)
                   else if (ok === "1") turn(true)
                   else setNotice(true)
                 }}
                 className={`size-10 items-center justify-center rounded-xl ${enabled ? "bg-primary" : ""}`}>
        <Icon icon={enabled ? Mic : MicOff} tone={enabled ? "primary-foreground" : "foreground"} size={20} />
        {listening && <View className="absolute top-1.5 right-1.5 size-2 rounded-full bg-orange" />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Voice command list" onPress={() => setHelp(true)}
                 className="size-8 items-center justify-center">
        <Icon icon={CircleHelp} tone="muted-foreground" size={18} />
      </Pressable>

      {tipDone === null && !enabled && (
        <View accessibilityRole="alert"
              className="absolute top-12 right-0 z-50 w-[260px] flex-row items-start gap-2 rounded-lg bg-foreground py-2 pr-1 pl-3">
          <Text className="flex-1 font-sans text-[13px] leading-5 text-background">
            <Text className="font-sans-semibold">Cook hands-free.</Text> Tap the mic, then say “next”, “back”,
            “start timer” or “stop timer”.
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close tip" onPress={() => setTipDone("1")}
                     className="size-6 items-center justify-center">
            <Icon icon={X} tone="background" size={16} />
          </Pressable>
        </View>
      )}

      <Sheet open={help} onClose={() => setHelp(false)} title="Voice commands" description="Tap the mic, then say:">
        <CommandList />
      </Sheet>

      <Sheet open={notice} onClose={() => setNotice(false)} title="Turn on voice commands?"
             description={private_
               ? "While the mic is on, this phone recognises what you say itself: your speech stays on the phone. Pantrila only reacts to the commands below and never records or stores your voice. Listening stops when you leave cooking mode or lock your phone."
               : `While the mic is on, your phone sends what you say to ${speechService()} to recognise the words. Pantrila only reacts to the commands below and never records or stores your voice. Listening stops when you leave cooking mode or lock your phone.`}
             footer={<>
               <Button text="Turn on" primary onPress={() => { setOk("1"); setNotice(false); turn(true) }} />
               <Button text="Not now" onPress={() => setNotice(false)} />
             </>}>
        <CommandList />
      </Sheet>

      <Sheet open={blocked} onClose={() => setBlocked(false)} title="Allow the microphone"
             description="Pantrila needs the microphone and speech recognition for voice commands."
             footer={<>
               <Button text="Open Settings" primary onPress={() => { setBlocked(false); Linking.openSettings() }} />
               <Button text="Close" onPress={() => setBlocked(false)} />
             </>}>
        {(Platform.OS === "ios"
          ? ["Tap Open Settings.", "Turn on Microphone and Speech Recognition for Pantrila.",
             "Speech still not working? Turn on Settings > General > Keyboard > Enable Dictation.",
             "Come back and tap the mic."]
          : ["Tap Open Settings.", "Open Permissions > Microphone and choose Allow.",
             "Speech still not working? Check that Speech Recognition & Synthesis from Google is installed and on.",
             "Come back and tap the mic."]
        ).map((s, i) => (
          <Text key={s} className="font-sans text-base text-foreground">{i + 1}. {s}</Text>
        ))}
      </Sheet>
    </View>
  )
}

function Button({ text, primary = false, onPress }: { text: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
               className={`h-12 items-center justify-center rounded-xl ${primary ? "bg-primary" : "border border-border bg-surface"}`}>
      <Text className={`font-sans-semibold text-base ${primary ? "text-primary-foreground" : "text-foreground"}`}>{text}</Text>
    </Pressable>
  )
}

function CommandList() {
  return (
    <View className="gap-2">
      {VOICE_COMMANDS.map((c) => (
        <View key={c.say} className="flex-row items-baseline gap-3">
          <View className="rounded-lg bg-primary-soft px-2 py-0.5">
            <Text className="font-sans-semibold text-[13px] text-primary-text">“{c.say}”</Text>
          </View>
          <Text className="flex-1 font-sans text-[13px] text-muted-foreground">{c.does}</Text>
        </View>
      ))}
    </View>
  )
}

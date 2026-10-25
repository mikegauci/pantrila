import { router, useLocalSearchParams } from "expo-router"
import { History, Info, Plus, Send } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, type ScrollViewInstance, Text, TextInput, View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSWRConfig } from "swr"

import { addWords, type LiveReply, STARTERS, startReply, withEvent } from "@pantrila/core/chat"
import { leftText } from "@pantrila/core/subscription"
import type { ChatThread, ChatThreadSummary } from "@pantrila/core/types"

import { Button } from "@/components/bits"
import { Bubble, ChatThreads, type Message, Rich } from "@/components/chat"
import { DictateButton } from "@/components/dictate-button"
import { Icon } from "@/components/icon"
import { Sheet } from "@/components/sheet"
import { ApiError, send, streamChat } from "@/lib/api"
import { useChat, useChats, useMe, useRefreshKitchen } from "@/lib/hooks"
import { useStored } from "@/lib/stored"
import { toast } from "@/lib/toast"

/** The cooking assistant, as on the web: saved chats, the reply streamed in as it is written
 * (`POST /chat/stream`), recipe cards, drafts to save to My recipes and dictation. Home's card
 * opens it with `?q=` (ask in a new chat) or `?thread=` (open that chat); the last chat opened is
 * kept on the phone for next time. */
export default function Assistant() {
  const params = useLocalSearchParams<{ q?: string; thread?: string }>()
  const insets = useSafeAreaInsets()
  const [stored, setStored] = useStored("chat-thread")
  // The chat picked on this screen; until then, the one opened last time.
  const [picked, setPicked] = useState<number | null>()
  const threadId = picked !== undefined ? picked : Number(stored) || null
  const ready = picked !== undefined || stored !== undefined
  const [pending, setPending] = useState<Message[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<LiveReply>()
  const [drawer, setDrawer] = useState(false)
  const [info, setInfo] = useState(false)
  const { data: me, mutate: refreshMe } = useMe()
  const { data: threads, mutate: refreshThreads } = useChats()
  const { data: thread, error: threadError } = useChat(threadId)
  const { mutate } = useSWRConfig()
  const refreshKitchen = useRefreshKitchen()
  const scroller = useRef<ScrollViewInstance>(null)
  // A remembered chat that was deleted (here or on another device) means a new chat.
  const current = threadError?.status === 404 ? null : threadId
  const messages: Message[] = [...(current ? thread?.messages ?? [] : []), ...pending]

  const chatsLeft = me?.limits.chats.left
  useEffect(() => {
    if (chatsLeft != null && chatsLeft > 0 && chatsLeft <= 3) {
      toast.error(`${chatsLeft} ${chatsLeft === 1 ? "message" : "messages"} left today.`)
    }
  }, [chatsLeft])

  // Home's card: ask its question in a new chat, or open the chat it lists. The params are then
  // cleared, so the same question asked again from Home is asked again.
  useEffect(() => {
    const q = params.q?.trim()
    const id = Number(params.thread)
    if (!q && !id) return
    if (q) {
      open(null)
      ask(q, null)
    } else {
      open(id)
    }
    // Opened straight on `?q=` (the app starting there), the router is not ready yet: try again.
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = () => {
      try {
        router.setParams({ q: undefined, thread: undefined })
      } catch {
        timer = setTimeout(clear, 50)
      }
    }
    clear()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per question or chat from Home
  }, [params.q, params.thread])

  function open(id: number | null) {
    setPicked(id)
    setStored(id ? String(id) : null)
    setPending([])
    setDrawer(false)
  }

  function remove(t: ChatThreadSummary) {
    Alert.alert(`Delete the chat “${t.title}”?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await send(`/me/chats/${t.id}`, "DELETE")
            if (t.id === current) open(null)
            refreshThreads()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not delete.")
          }
        },
      },
    ])
  }

  async function ask(message: string, inThread = current) {
    if (!message.trim() || busy) return
    setText("")
    setBusy(true)
    const asked: Message = { role: "user", text: message }
    setPending([asked])
    setLive(startReply())
    try {
      const reply = await streamChat({ message, thread_id: inThread }, (e) => setLive((l) => l && withEvent(l, e)))
      const answered: Message = { role: "assistant", text: reply.text, reply }
      // The server saved both messages; put them in the cache instead of fetching the chat again.
      await mutate<ChatThread>(`/me/chats/${reply.thread_id}`, (t) => ({
        id: reply.thread_id,
        title: t?.title ?? message,
        updated_at: new Date().toISOString(),
        messages: [...(t?.messages ?? []), asked, answered].slice(-200),
      }), { revalidate: false })
      setPicked(reply.thread_id)
      setStored(String(reply.thread_id))
      setPending([])
      refreshThreads()
      if (reply.pantry_changed) refreshKitchen()
    } catch (e) {
      // A Free day's chats used up is a 402 whose message says so; the in-app Pro offer comes with PR 12.
      if (e instanceof ApiError && e.status === 409 && inThread) await mutate(`/me/chats/${inThread}`)
      const msg = e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again."
      setPending([asked, { role: "assistant", text: msg, error: true }])
    } finally {
      setBusy(false)
      setLive(undefined)
      refreshMe()
    }
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}
                          keyboardVerticalOffset={insets.top + 56}>
      <View className="flex-row gap-2 px-4 pt-1 pb-2">
        <Button variant="outline" size="sm" icon={History} text="Chats" onPress={() => setDrawer(true)} />
        <Button variant="outline" size="sm" icon={Plus} text="New" disabled={busy} onPress={() => open(null)} />
        <View className="flex-1" />
        <Button variant="outline" size="sm" icon={Info} text="Info" onPress={() => setInfo(true)} />
      </View>

      <ScrollView ref={scroller} className="mx-4 flex-1 rounded-[20px] border border-border bg-primary-soft"
                  contentContainerClassName="grow gap-4 p-4" keyboardShouldPersistTaps="handled"
                  onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
        {!ready || (current && !thread && !threadError && !pending.length) ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="font-sans text-[13px] text-muted-foreground">Loading chat…</Text>
          </View>
        ) : messages.length === 0 ? (
          <View className="flex-1 justify-center gap-4">
            <Text className="text-center font-sans-semibold text-lg text-foreground">Ask about cooking, recipes or your pantry</Text>
            <View className="items-center gap-2">
              {STARTERS.map((s) => (
                <Pressable key={s} accessibilityRole="button" onPress={() => ask(s)}
                           className="min-h-9 justify-center rounded-lg border border-border bg-surface px-3 py-1.5">
                  <Text className="text-center font-sans-medium text-sm text-foreground">{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <>
            {messages.map((m, i) => <Bubble key={i} m={m} thread={current} />)}
            {busy && live?.text ? (
              <View className="max-w-[92%] rounded-[20px] rounded-bl-md border border-border bg-surface px-4 py-3">
                <Rich text={live.text} recipes={live.cards} />
              </View>
            ) : busy && (
              <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2">
                <ActivityIndicator size="small" />
                <Text className="font-sans text-[13px] text-muted-foreground">{live?.label ?? "Thinking…"}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View className="flex-row items-end gap-2 px-4 pt-2 pb-3">
        <TextInput accessibilityLabel="Message" placeholder="Ask Pantrila…" placeholderTextColorClassName="accent-muted-foreground"
                   value={text} onChangeText={setText} maxLength={2000} multiline
                   className="max-h-32 min-h-11 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 font-sans text-base text-foreground" />
        <DictateButton onHeard={(words) => setText((t) => addWords(t, words))} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={busy || !text.trim()} onPress={() => ask(text)}
                   className={`size-11 items-center justify-center rounded-xl bg-primary ${busy || !text.trim() ? "opacity-50" : ""}`}>
          <Icon icon={Send} tone="primary-foreground" size={18} />
        </Pressable>
      </View>

      <Sheet open={drawer} onClose={() => setDrawer(false)} title="Chats"
             footer={<Button icon={Plus} text="New chat" disabled={busy} onPress={() => open(null)} />}>
        <ChatThreads threads={threads} current={current} disabled={busy} onSelect={open} onDelete={remove} />
      </Sheet>

      <Sheet open={info} onClose={() => setInfo(false)} title="What Pantrila does">
        {[
          "Finds recipes, checks what is in your pantry and suggests swaps.",
          "Scales a recipe to your servings and writes new ones you can save to My recipes.",
          "Updates your pantry when you say you bought or used something.",
          "Uses your profile: allergies, diet and nutrition targets.",
        ].map((l) => <Text key={l} className="font-sans text-base text-foreground">• {l}</Text>)}
        <Text accessibilityRole="header" className="mt-2 font-sans-semibold text-base text-foreground">Good to know</Text>
        {[
          "Recipes it shows are checked against your rules, but read the ingredients if you have an allergy.",
          "Chats are saved. Start a new one for a new topic.",
          ...(me ? [`${leftText("chat", me.limits.chats)}.`] : []),
        ].map((l) => <Text key={l} className="font-sans text-base text-muted-foreground">• {l}</Text>)}
      </Sheet>
    </KeyboardAvoidingView>
  )
}

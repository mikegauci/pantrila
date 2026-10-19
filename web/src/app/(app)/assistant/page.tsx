"use client"

import { BookmarkPlus, History, Loader2, PenLine, Plus, Refrigerator, Repeat, Scale, Search, Send, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { useAuth } from "@/components/auth-provider"
import { STARTERS } from "@/components/ask-pantrio"
import { AiBadge, ProblemAlert } from "@/components/bits"
import { ChatThreads } from "@/components/chat-threads"
import { CHAT_DRAFT } from "@/components/cookbook-form"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send } from "@/lib/api"
import { seconds, usd } from "@/lib/format"
import { useChat, useChats, useMe, useRefreshKitchen } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { ChatMessage, ChatReply, ChatThread, ChatThreadSummary, CookbookRecipeIn, RecipeCard, ToolCall } from "@/lib/types"

/** A saved message, or one only this page knows about: the question in flight or an error. */
interface Message extends ChatMessage {
  error?: boolean
}

const LAST_THREAD = "pantrio-chat-thread"

function toolSummary(c: ToolCall): { icon: typeof Search; text: string } {
  const a = c.arguments as Record<string, string | number | null>
  const lines = c.output.split("\n").filter(Boolean)
  switch (c.name) {
    case "search_recipes":
      return { icon: Search, text: c.output === "no recipes match"
        ? `Searched “${a.query}”: nothing passed your filters`
        : `Searched “${a.query}”: ${lines.length} recipe${lines.length === 1 ? "" : "s"} matched your filters` }
    case "check_pantry":
      return { icon: Refrigerator, text: a.recipe_id ? `Checked your pantry against ${a.recipe_id}` : "Checked your pantry" }
    case "update_pantry":
      return { icon: Refrigerator, text: `Updated your pantry: ${lines.join("; ")}` }
    case "swap_ingredient":
      return { icon: Repeat, text: `Checked swaps for ${a.food} in ${a.recipe_id}` }
    case "scale_recipe":
      return { icon: Scale, text: `Scaled ${a.recipe_id} to ${a.servings} servings` }
    case "write_recipe":
      return { icon: PenLine, text: `Wrote “${a.title}” and checked it against your rules` }
    default:
      return { icon: Sparkles, text: c.name }
  }
}

/** Plain text with **bold**, # headings, line breaks and [recipe-id] citations turned into links. */
function Rich({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  return (
    <>
      {text.split("\n").map((line, li) => {
        // A markdown heading ("#### Ingredients") shows as a bold line.
        const heading = line.match(/^#{1,6}\s+(.*)$/)
        return (
          <Fragment key={li}>
            {li > 0 && <br />}
            {heading ? <strong>{heading[1].replace(/\*\*/g, "")}</strong> : line.split(/(\[[a-z0-9]+(?:-[a-z0-9]+)+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
              const cite = part.match(/^\[([a-z0-9-]+)\]$/)
              if (cite) {
                const r = recipes.get(cite[1])
                return r ? (
                  <Link key={i} href={`/recipes/${r.id}`}
                        className={cn("font-medium underline underline-offset-2", r.problems.length ? "text-danger" : "text-primary-text")}>
                    ↗
                  </Link>
                ) : <span key={i} className="text-muted-foreground">{part}</span>
              }
              if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>
              return <Fragment key={i}>{part}</Fragment>
            })}
          </Fragment>
        )
      })}
    </>
  )
}

function Bubble({ m }: { m: Message }) {
  const router = useRouter()
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        {m.text}
      </div>
    )
  }
  const r = m.reply
  const save = (d: CookbookRecipeIn) => {
    sessionStorage.setItem(CHAT_DRAFT, JSON.stringify(d))
    router.push("/recipes/mine/new?from=chat")
  }
  const recipes = new Map(r?.cited.map((c) => [c.id, c]))
  return (
    <div className="grid max-w-[92%] gap-2">
      <ProblemAlert title="Current profile check" items={r?.profile_problems ?? []} />
      {r?.tool_calls.map((c, i) => {
        const { icon: Icon, text } = toolSummary(c)
        return (
          <div key={i} className="flex items-start gap-2 rounded-xl border border-dashed bg-surface-muted px-3 py-2 text-[12px] text-muted-foreground">
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {text}
          </div>
        )
      })}
      <div className={cn("rounded-[20px] rounded-bl-md border bg-surface px-4 py-3", m.error && "border-danger/50 text-danger")}>
        <Rich text={m.text} recipes={recipes} />
      </div>
      {r && r.cited.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.cited.map((c) => (
            <Link key={c.id} href={`/recipes/${c.id}`}
                  className={cn("rounded-full border px-3 py-1 text-[12px] font-medium hover:shadow-soft",
                    c.problems.length ? "border-danger bg-danger-soft text-danger" : "bg-primary-soft text-primary-text")}>
              {c.title} · {Math.round(c.nutrition.kcal)} kcal
            </Link>
          ))}
        </div>
      )}
      {r?.drafts?.map((d, i) => (
        <Button key={i} variant="outline" size="sm" className="w-fit"
                onClick={() => save(d)}>
          <BookmarkPlus /> Save “{d.title}” to My recipes
        </Button>
      ))}
      {r && (
        <p className="tabular text-[11px] text-muted-foreground">
          {seconds(r.latency_ms)} · {usd(r.cost_usd)}
          {r.flagged.length > 0 && " · safety note added by code"}
        </p>
      )}
    </div>
  )
}

export default function AssistantPage() {
  const { session } = useAuth()
  const lastThreadKey = `${LAST_THREAD}:${session!.user.id}`
  // Rendered only on the client after sign-in, so localStorage and the URL are available here.
  // Home links here with ?q= (ask it in a new chat) or ?thread= (open that chat).
  const [threadId, setThreadId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.has("q") ? null : Number(params.get("thread")) || Number(localStorage.getItem(lastThreadKey)) || null
  })
  const [pending, setPending] = useState<Message[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const { data: me, mutate: refreshMe } = useMe()
  const { data: threads, mutate: refreshThreads } = useChats()
  const { data: thread, error: threadError } = useChat(threadId)
  const { mutate } = useSWRConfig()
  const refreshKitchen = useRefreshKitchen()
  const end = useRef<HTMLDivElement>(null)
  // A remembered chat that was deleted (here or on another device) means a new chat.
  const current = threadError?.status === 404 ? null : threadId
  const messages: Message[] = [...(current ? thread?.messages ?? [] : []), ...pending]

  useEffect(() => {
    if (current) localStorage.setItem(lastThreadKey, String(current))
    else localStorage.removeItem(lastThreadKey)
  }, [current, lastThreadKey])

  useEffect(() => {
    // Next keeps this page mounted but hidden between visits (Cache Components use React Activity) and
    // re-runs this effect each time it is shown, so read the URL now rather than from state.
    const params = new URLSearchParams(window.location.search)
    if (!params.size) return
    // Clear it without a Next navigation (that could remount the page and lose the chat in flight); this
    // also stops a second run (Strict Mode) from asking twice.
    window.history.replaceState(null, "", "/assistant")
    const q = params.get("q")?.trim()
    const thread = Number(params.get("thread"))
    if (q) {
      open(null)
      ask(q, null)
    } else if (thread) {
      open(thread)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length])

  function open(id: number | null) {
    setThreadId(id)
    setPending([])
    setDrawer(false)
  }

  async function remove(t: ChatThreadSummary) {
    if (!window.confirm(`Delete the chat “${t.title}”?`)) return
    try {
      await send(`/me/chats/${t.id}`, "DELETE")
      if (t.id === current) open(null)
      refreshThreads()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.")
    }
  }

  async function ask(message: string, thread = current) {
    if (!message.trim() || busy) return
    setText("")
    setBusy(true)
    const asked: Message = { role: "user", text: message }
    setPending([asked])
    try {
      const reply = await send<ChatReply>("/chat", "POST", { message, thread_id: thread })
      const answered: Message = { role: "assistant", text: reply.text, reply }
      // The server saved both messages; put them in the cache instead of fetching the thread again.
      await mutate<ChatThread>(`/me/chats/${reply.thread_id}`, (t) => ({
        id: reply.thread_id,
        title: t?.title ?? message,
        updated_at: new Date().toISOString(),
        messages: [...(t?.messages ?? []), asked, answered].slice(-200),
      }), { revalidate: false })
      setThreadId(reply.thread_id)
      setPending([])
      refreshThreads()
      if (reply.pantry_changed) refreshKitchen()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && thread) await mutate(`/me/chats/${thread}`)
      const msg = e instanceof ApiError ? e.message : "Could not reach Pantrio. Try again."
      setPending([asked, { role: "assistant", text: msg, error: true }])
    } finally {
      setBusy(false)
      refreshMe()
    }
  }

  const list = (
    <ChatThreads threads={threads} current={current} disabled={busy} onSelect={open} onDelete={remove} />
  )

  return (
    <div className="mx-auto flex h-[calc(100dvh-72px-2.5rem-6rem)] max-w-5xl gap-4 md:h-[calc(100dvh-72px-4rem)]">
      <aside className="hidden w-60 shrink-0 flex-col md:flex" aria-label="Chats">
        <Button variant="outline" size="sm" className="mb-3 justify-start" disabled={busy} onClick={() => open(null)}>
          <Plus /> New chat
        </Button>
        <div className="flex-1 overflow-y-auto">{list}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <AiBadge>Cooking assistant</AiBadge>
          <div className="ml-auto flex gap-1 md:hidden">
            <Sheet open={drawer} onOpenChange={setDrawer}>
              <SheetTrigger render={<Button variant="outline" size="sm" />}>
                <History /> Chats
              </SheetTrigger>
              <SheetContent side="left" className="gap-3 p-4">
                <SheetHeader className="p-0">
                  <SheetTitle>Chats</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto">{list}</div>
              </SheetContent>
            </Sheet>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => open(null)}>
              <Plus /> New
            </Button>
          </div>
          <span className="w-full text-[12px] text-muted-foreground md:w-auto">
            Knows your profile and pantry. {me && `${me.limits.chats_left} messages left today.`}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto rounded-[20px] border bg-background/60 p-4 shadow-soft" aria-live="polite">
          {current && !thread && !pending.length ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading chat…
            </p>
          ) : messages.length === 0 ? (
            <div className="grid h-full place-content-center gap-4 text-center">
              <p className="text-[18px] font-semibold">Ask about cooking, recipes or your pantry</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => ask(s)}>{s}</Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {messages.map((m, i) => <Bubble key={i} m={m} />)}
              {busy && (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Thinking and checking…
                </p>
              )}
              <div ref={end} />
            </div>
          )}
        </div>

        <form
          data-tour="chat-composer"
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(text)
          }}
        >
          <Textarea
            aria-label="Message"
            placeholder="Ask Pantrio…"
            value={text}
            maxLength={2000}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                ask(text)
              }
            }}
            className="max-h-32 min-h-11 resize-none rounded-xl bg-surface"
          />
          <Button type="submit" size="icon" className="size-11" disabled={busy || !text.trim()} aria-label="Send">
            <Send />
          </Button>
        </form>
      </div>
    </div>
  )
}

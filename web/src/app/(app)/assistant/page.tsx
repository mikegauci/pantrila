"use client"

import { Loader2, Refrigerator, Repeat, Scale, Search, Send, Sparkles, Trash2 } from "lucide-react"
import Link from "next/link"
import { Fragment, useEffect, useRef, useState } from "react"
import { useSWRConfig } from "swr"

import { AiBadge } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send } from "@/lib/api"
import { seconds, usd } from "@/lib/format"
import { useMe } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { ChatReply, ChatTurn, RecipeCard, ToolCall } from "@/lib/types"

interface Message {
  role: "user" | "assistant"
  text: string
  reply?: ChatReply
  error?: boolean
}

const STORAGE = "pantrio-chat"
const STARTERS = [
  "What can I cook tonight with what I have?",
  "I just bought eggs, spinach and feta.",
  "Find a quick high-protein breakfast.",
  "What does “fold in” mean?",
]

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
    default:
      return { icon: Sparkles, text: c.name }
  }
}

/** Plain text with **bold**, line breaks and [recipe-id] citations turned into links. */
function Rich({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {line.split(/(\[[a-z0-9]+(?:-[a-z0-9]+)+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
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
      ))}
    </>
  )
}

function Bubble({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        {m.text}
      </div>
    )
  }
  const r = m.reply
  const recipes = new Map(r?.cited.map((c) => [c.id, c]))
  return (
    <div className="grid max-w-[92%] gap-2">
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
  // Rendered only on the client after sign-in, so sessionStorage is available here.
  const [saved] = useState(() => JSON.parse(sessionStorage.getItem(STORAGE) ?? "null"))
  const [messages, setMessages] = useState<Message[]>(saved?.messages ?? [])
  const [history, setHistory] = useState<ChatTurn[]>(saved?.history ?? [])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const { data: me, mutate: refreshMe } = useMe()
  const { mutate } = useSWRConfig()
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionStorage.setItem(STORAGE, JSON.stringify({ messages, history }))
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, history])

  async function ask(message: string) {
    if (!message.trim() || busy) return
    setText("")
    setBusy(true)
    setMessages((m) => [...m, { role: "user", text: message }])
    try {
      const reply = await send<ChatReply>("/chat", "POST", { message, history })
      setHistory(reply.history)
      setMessages((m) => [...m, { role: "assistant", text: reply.text, reply }])
      if (reply.pantry_changed) mutate("/me/pantry")
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not reach Pantrio. Try again."
      setMessages((m) => [...m, { role: "assistant", text: msg, error: true }])
    } finally {
      setBusy(false)
      refreshMe()
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-72px-2.5rem-6rem)] max-w-3xl flex-col md:h-[calc(100dvh-72px-4rem)]">
      <div className="mb-3 flex items-center gap-2">
        <AiBadge>Cooking assistant</AiBadge>
        <span className="text-[12px] text-muted-foreground">
          Knows your profile and pantry. {me && `${me.limits.chats_left} messages left today.`}
        </span>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setMessages([]); setHistory([]) }}>
            <Trash2 /> Clear
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto rounded-[20px] border bg-background/60 p-4 shadow-soft" aria-live="polite">
        {messages.length === 0 ? (
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
  )
}

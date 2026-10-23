"use client"

import { Popover } from "@base-ui/react/popover"
import { BookmarkPlus, Check, History, Info, Loader2, PenLine, Plus, Refrigerator, Repeat, Scale, Search, Send, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { useAuth } from "@/components/auth-provider"
import { STARTERS } from "@/components/ask-pantrila"
import { AiBadge, ProblemAlert, RecipeArt } from "@/components/bits"
import { ChatThreads } from "@/components/chat-threads"
import { CHAT_DRAFT } from "@/components/cookbook-form"
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send, streamChat } from "@/lib/api"
import { useChat, useChats, useCookbook, useMe, useRecipe, useRefreshKitchen } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { ChatMessage, ChatThread, ChatThreadSummary, CookbookRecipeIn, RecipeCard, ToolCall } from "@/lib/types"

/** A saved message, or one only this page knows about: the question in flight or an error. */
interface Message extends ChatMessage {
  error?: boolean
}

const LAST_THREAD = "pantrila-chat-thread"

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

/** Words only, lower case, so "**Prawn and Rice:** " and "Prawn and Rice" compare equal. */
function plainTitle(s: string) {
  return s.replace(/\*\*/g, "").replace(/[\s:–—-]+$/, "").trim().toLowerCase()
}

/** The model often writes a recipe's title just before its link. The link shows the title, so that text goes. */
function withoutTitles(parts: string[], recipes: Map<string, RecipeCard>): string[] {
  return parts.map((part, i) => {
    const cite = parts[i + 1]?.match(/^\[([a-z0-9-]+)\]$/)
    const r = cite && recipes.get(cite[1])
    return r && plainTitle(part) === plainTitle(r.title) ? "" : part
  })
}

/** A line's text: **bold** and [recipe-id] citations, each citation a link titled as its recipe. */
function Inline({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  const parts = withoutTitles(text.split(/(\[[a-z0-9]+(?:-[a-z0-9]+)*\]|\*\*[^*]+\*\*)/g), recipes)
  return (
    <>
      {parts.map((part, i) => {
        const cite = part.match(/^\[([a-z0-9-]+)\]$/)
        if (cite) {
          const r = recipes.get(cite[1])
          return r ? (
            <Fragment key={i}>
              <Link href={`/recipes/${r.id}`}
                    className={cn("font-medium underline underline-offset-2", r.problems.length ? "text-danger" : "text-primary-text")}>
                {r.title}
              </Link>
              <span className="text-muted-foreground"> · {Math.round(r.nutrition.kcal)} kcal</span>
            </Fragment>
          ) : <span key={i} className="text-muted-foreground">{part}</span>
        }
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}

type Block = { list: boolean; lines: string[] }

/** Paragraphs and bulleted lists, with headings as bold lines and blank lines as paragraph breaks. */
function Rich({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  const blocks: Block[] = []
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
    const trimmed = line.trim()
    if (!trimmed || citesOnly(trimmed, recipes)) continue
    const last = blocks.at(-1)
    if (item) {
      if (last?.list) last.lines.push(item[1])
      else blocks.push({ list: true, lines: [item[1]] })
    } else if (last && !last.list) {
      last.lines.push(trimmed)
    } else {
      blocks.push({ list: false, lines: [trimmed] })
    }
  }
  return (
    <div className="grid min-w-0 gap-2.5">
      {blocks.map((b, bi) => {
        if (b.list) {
          return (
            <ul key={bi} className="grid min-w-0 list-disc gap-1.5 pl-5 marker:text-muted-foreground">
              {b.lines.map((l, li) => <li key={li} className="pl-1"><Inline text={l} recipes={recipes} /></li>)}
            </ul>
          )
        }
        return (
          <p key={bi}>
            {b.lines.map((l, li) => {
              // A markdown heading ("#### Ingredients") shows as a bold line.
              const heading = l.match(/^#{1,6}\s+(.*)$/)
              return (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {heading ? <strong>{heading[1].replace(/\*\*/g, "")}</strong> : <Inline text={l} recipes={recipes} />}
                </Fragment>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}

/** A recipe the reply uses: photo, title, time and kcal, and cook mode at the servings the reply gave. */
function RecipeCardView({ id, servings }: { id: string; servings?: number }) {
  const { data: recipe } = useRecipe(id)
  if (!recipe) return null
  return (
    <div className="flex w-44 shrink-0 snap-start flex-col gap-2 rounded-[16px] border bg-surface p-2">
      <Link href={`/recipes/${id}`} className="group grid gap-2">
        <RecipeArt meal={recipe.meal_types[0]} cuisine={recipe.cuisine || undefined} photo={recipe.photo_url}
          sizes="176px" className="aspect-[4/3] w-full" />
        <span className="line-clamp-2 px-1 text-[13px] font-semibold leading-5 group-hover:text-primary-text">{recipe.title}</span>
      </Link>
      <p className="tabular px-1 text-[12px] text-muted-foreground">{recipe.total_minutes} min · {Math.round(recipe.nutrition.kcal)} kcal</p>
      {recipe.problems.length > 0 && <p className="px-1 text-[12px] font-medium text-danger">Not for you</p>}
      <Link href={`/recipes/${id}/cook?servings=${servings ?? recipe.servings}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-auto w-full")}>
        Let&apos;s cook this!
      </Link>
    </div>
  )
}

/**
 * A reply line that only names recipes (a citation, its title and kcal): the recipe cards show it,
 * so the line goes. Lines with any other words stay.
 */
function citesOnly(line: string, recipes: Map<string, RecipeCard>): boolean {
  const cites = line.match(/\[[a-z0-9-]+\]/g)
  if (!cites || !cites.every((c) => recipes.has(c.slice(1, -1)))) return false
  let rest = line.replace(/\*\*/g, "").replace(/\d+\s*kcal/gi, "").toLowerCase()
  for (const c of cites) rest = rest.split(c).join("")
  for (const r of recipes.values()) rest = rest.split(r.title.toLowerCase()).join("")
  return /^[\s·\-–—:,.|]*$/.test(rest)
}

/**
 * Which draft of which chat a saved recipe came from: the thread and a hash of the draft as the
 * assistant wrote it, so a changed version written later in the chat counts as a new draft.
 */
function draftTag(thread: number | null, d: CookbookRecipeIn): string | null {
  if (!thread) return null
  let h = 0x811c9dc5  // FNV-1a, 32 bits; the tag itself is left out
  for (const ch of JSON.stringify({ ...d, chat_draft: undefined })) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${thread}:${h.toString(16).padStart(8, "0")}`
}

function Bubble({ m, thread }: { m: Message; thread: number | null }) {
  const router = useRouter()
  const { session } = useAuth()
  const userId = session!.user.id
  const { data: cookbook } = useCookbook()
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        {m.text}
      </div>
    )
  }
  const r = m.reply
  const save = (d: CookbookRecipeIn) => {
    sessionStorage.setItem(`${CHAT_DRAFT}:${userId}`, JSON.stringify({ ...d, chat_draft: draftTag(thread, d) }))
    router.push(`/recipes/mine/new?from=chat${thread ? `&thread=${thread}` : ""}`)
  }
  const recipes = new Map(r?.cited.map((c) => [c.id, c]))
  // Recipes the reply uses: cited in the text, or scaled by a tool (its servings are the reply's).
  const used = new Map<string, number | undefined>()
  for (const c of r?.tool_calls ?? []) {
    if (c.name === "scale_recipe") used.set(String(c.arguments.recipe_id), Number(c.arguments.servings))
  }
  for (const c of r?.cited ?? []) if (!used.has(c.id)) used.set(c.id, undefined)
  return (
    <div className="grid min-w-0 max-w-[92%] gap-2">
      <ProblemAlert title="Current profile check" items={r?.profile_problems ?? []} />
      {r?.tool_calls.map((c, i) => {
        const { icon: Icon, text } = toolSummary(c)
        return (
          <div key={i} className="flex items-start gap-2 rounded-xl border border-dashed bg-surface-muted px-3 py-2 text-[12px] text-muted-foreground">
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {text}
          </div>
        )
      })}
      <div className={cn("min-w-0 break-words rounded-[20px] rounded-bl-md border bg-surface px-4 py-3", m.error && "border-danger/50 text-danger")}>
        <Rich text={m.text} recipes={recipes} />
        {!m.error && used.size > 0 && (
          <div className="no-scrollbar -mx-1 mt-3 flex snap-x gap-3 overflow-x-auto border-t px-1 pt-3 pb-1">
            {[...used].map(([id, servings]) => <RecipeCardView key={id} id={id} servings={servings} />)}
          </div>
        )}
      </div>
      {r?.drafts?.map((d, i) => {
        const tag = draftTag(thread, d)
        const saved = tag ? cookbook?.find((c) => c.chat_draft === tag) : undefined
        return (
          <div key={i} className="grid gap-2">
            <ProblemAlert title={`Check ${d.title}`} items={r.draft_problems?.[i] ?? []} />
            {saved ? (
              <Link href={`/recipes/mine/${saved.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}>
                <Check className="text-primary-text" /> Saved to My recipes as “{saved.title}”
              </Link>
            ) : (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => save(d)}>
                <BookmarkPlus /> Save “{d.title}” to My recipes
              </Button>
            )}
          </div>
        )
      })}
      {r && r.flagged.length > 0 && (
        <p className="text-[11px] text-muted-foreground">safety note added by code</p>
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
  // The reply in flight: what the assistant is doing, its text so far and the recipes it found.
  const [live, setLive] = useState<{ label: string; text: string; cards: Map<string, RecipeCard> }>()
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

  const chatsLeft = me?.limits.chats_left
  useEffect(() => {
    if (chatsLeft != null && chatsLeft > 0 && chatsLeft <= 3) {
      toast.warning(`${chatsLeft} ${chatsLeft === 1 ? "message" : "messages"} left today.`)
    }
  }, [chatsLeft])

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
  }, [messages.length, live?.text.length, live?.label])

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
    setLive({ label: "Thinking…", text: "", cards: new Map() })
    try {
      const reply = await streamChat({ message, thread_id: thread }, (e) => setLive((l) => {
        if (!l) return l
        // A new step after some text means that text led into a tool call; the reply comes after it.
        if (e.kind === "step") return { ...l, label: e.label, text: "" }
        if (e.kind === "delta") return { ...l, text: l.text + e.text }
        return { ...l, cards: new Map([...l.cards, ...e.cards.map((c) => [c.id, c] as const)]) }
      }))
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
      const msg = e instanceof ApiError ? e.message : "Could not reach Pantrila. Try again."
      setPending([asked, { role: "assistant", text: msg, error: true }])
    } finally {
      setBusy(false)
      setLive(undefined)
      refreshMe()
    }
  }

  const list = (
    <ChatThreads threads={threads} current={current} disabled={busy} onSelect={open} onDelete={remove} />
  )

  return (
    // On phones pull up into the page's top padding (20 px) so the gap under the header matches the gap above the chat.
    <div className="mx-auto -mt-3 flex h-[calc(100dvh-152px)] max-w-5xl gap-4 md:mt-0 md:h-[calc(100dvh-72px-4rem)]">
      <aside className="hidden w-60 shrink-0 flex-col md:flex" aria-label="Chats">
        <Button variant="outline" size="sm" className="mb-3 justify-start" disabled={busy} onClick={() => open(null)}>
          <Plus /> New chat
        </Button>
        <div className="flex-1 overflow-y-auto">{list}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex flex-wrap items-center gap-2 md:mb-3">
          <div className="hidden md:block"><AiBadge>Cooking assistant</AiBadge></div>
          <div className="ml-auto flex gap-1">
            <Popover.Root>
              <Popover.Trigger className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Info /> Info
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50">
                  <Popover.Popup className="w-72 max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-3 text-[13px] leading-5 text-popover-foreground shadow-lg outline-none">
                    <p className="font-semibold">What Pantrila does</p>
                    <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-muted-foreground">
                      <li>Finds recipes, checks what is in your pantry and suggests swaps.</li>
                      <li>Scales a recipe to your servings and writes new ones you can save to My recipes.</li>
                      <li>Updates your pantry when you say you bought or used something.</li>
                      <li>Uses your profile: allergies, diet and nutrition targets.</li>
                    </ul>
                    <p className="mt-2 font-semibold">Good to know</p>
                    <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-muted-foreground">
                      <li>Recipes it shows are checked against your rules, but read the ingredients if you have an allergy.</li>
                      <li>Chats are saved. Start a new one for a new topic.</li>
                      {me && <li>{me.limits.chats_left} {me.limits.chats_left === 1 ? "message" : "messages"} left today.</li>}
                    </ul>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <div className="flex gap-1 md:hidden">
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden rounded-[20px] border bg-primary-soft p-4 shadow-soft" aria-live="polite">
          {current && !thread && !pending.length ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading chat…
            </p>
          ) : messages.length === 0 ? (
            <div className="grid h-full place-content-center gap-4 text-center">
              <p className="text-[18px] font-semibold">Ask about cooking, recipes or your pantry</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="bg-surface" onClick={() => ask(s)}>{s}</Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {messages.map((m, i) => <Bubble key={i} m={m} thread={current} />)}
              {busy && live?.text ? (
                <div className="min-w-0 max-w-[92%] break-words rounded-[20px] rounded-bl-md border bg-surface px-4 py-3">
                  <Rich text={live.text} recipes={live.cards} />
                </div>
              ) : busy && (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> {live?.label ?? "Thinking…"}
                </p>
              )}
              <div ref={end} />
            </div>
          )}
        </div>

        <form
          data-tour="chat-composer"
          className="mt-2 flex items-end gap-2 md:mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            ask(text)
          }}
        >
          <Textarea
            aria-label="Message"
            placeholder="Ask Pantrila…"
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

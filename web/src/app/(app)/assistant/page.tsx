"use client"

import { Popover } from "@base-ui/react/popover"
import { BookmarkPlus, Check, History, Info, Loader2, PenLine, Plus, Refrigerator, Repeat, Scale, Search, Send, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import {
  addWords, chatBlocks, draftTag, headingOf, inlineParts, type LiveReply, STARTERS, startReply, type ToolIcon, toolSummary, usedRecipes,
  withEvent,
} from "@pantrila/core/chat"
import type { ChatMessage, ChatThread, ChatThreadSummary, CookbookRecipeIn, RecipeCard } from "@pantrila/core/types"
import { leftText } from "@pantrila/core/subscription"

import { useAuth } from "@/components/auth-provider"
import { AiBadge, ProblemAlert, RecipeArt } from "@/components/bits"
import { ChatThreads } from "@/components/chat-threads"
import { CHAT_DRAFT } from "@/components/cookbook-form"
import { DictateButton } from "@/components/dictate-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, send, streamChat } from "@/lib/api"
import { askForPro } from "@/lib/pro"
import { useChat, useChats, useCookbook, useMe, useRecipe, useRefreshKitchen } from "@/lib/hooks"
import { cn } from "@/lib/utils"

/** A saved message, or one only this page knows about: the question in flight or an error. */
interface Message extends ChatMessage {
  error?: boolean
}

const LAST_THREAD = "pantrila-chat-thread"

const TOOL_ICON: Record<ToolIcon, typeof Search> = {
  search: Search, pantry: Refrigerator, swap: Repeat, scale: Scale, write: PenLine, other: Sparkles,
}

/** A line's text: **bold** and [recipe-id] citations, each citation a link titled as its recipe. */
function Inline({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  return (
    <>
      {inlineParts(text, recipes).map((part, i) => {
        if (part.kind === "cite") {
          const r = part.recipe
          return r ? (
            <Fragment key={i}>
              <Link href={`/recipes/${r.id}`}
                    className={cn("font-medium underline underline-offset-2", r.problems.length ? "text-danger" : "text-primary-text")}>
                {r.title}
              </Link>
              <span className="text-muted-foreground"> · {Math.round(r.nutrition.kcal)} kcal</span>
            </Fragment>
          ) : <span key={i} className="text-muted-foreground">{part.text}</span>
        }
        if (part.kind === "bold") return <strong key={i}>{part.text}</strong>
        return <Fragment key={i}>{part.text}</Fragment>
      })}
    </>
  )
}

/** Paragraphs and bulleted lists, with headings as bold lines and blank lines as paragraph breaks. */
function Rich({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  return (
    <div className="grid min-w-0 gap-2.5">
      {chatBlocks(text, recipes).map((b, bi) => {
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
              const heading = headingOf(l)
              return (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {heading ? <strong>{heading}</strong> : <Inline text={l} recipes={recipes} />}
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
  const used = usedRecipes(r)
  return (
    <div className="grid min-w-0 max-w-[92%] gap-2">
      <ProblemAlert title="Current profile check" items={r?.profile_problems ?? []} />
      {r?.tool_calls.map((c, i) => {
        const { icon, text } = toolSummary(c)
        const Icon = TOOL_ICON[icon]
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
  const [live, setLive] = useState<LiveReply>()
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

  const chatsLeft = me?.limits.chats.left
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
    setLive(startReply())
    try {
      const reply = await streamChat({ message, thread_id: thread }, (e) => setLive((l) => l && withEvent(l, e)))
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
      askForPro(e)
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
                      {me && <li>{leftText("chat", me.limits.chats)}.</li>}
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
          <DictateButton onHeard={(words) => setText((t) => addWords(t, words))} />
          <Button type="submit" size="icon" className="size-11" disabled={busy || !text.trim()} aria-label="Send">
            <Send />
          </Button>
        </form>
      </div>
    </div>
  )
}

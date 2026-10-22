"use client"

import { ArrowRight, MessageCircle, Send } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { AiBadge, Panel } from "@/components/bits"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useChats } from "@/lib/hooks"

export const STARTERS = [
  "What can I cook tonight with what I have?",
  "I just bought eggs, spinach and feta.",
  "Find a quick high-protein breakfast.",
]

/** Home card: a question typed or picked here opens a new chat on the Assistant page. */
export function AskPantrila() {
  const router = useRouter()
  const [text, setText] = useState("")
  const { data: threads } = useChats()
  const recent = threads?.slice(0, 3) ?? []

  function ask(message: string) {
    if (message.trim()) router.push(`/assistant?q=${encodeURIComponent(message.trim())}`)
  }

  return (
    <Panel className="min-w-0 bg-primary-soft" data-tour="ask-pantrila">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold leading-[26px]">Ask Pantrila</h2>
        <AiBadge>Cooking assistant</AiBadge>
        <Link href="/assistant" className={buttonVariants({ variant: "ghost", size: "sm", className: "ml-auto" })}>
          Open <ArrowRight />
        </Link>
      </div>
      <p className="mb-4 text-muted-foreground">
        It knows your diet, allergies and pantry, searches the recipes, updates your pantry and
        checks every recipe it suggests against your rules.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <Input
          aria-label="Ask Pantrila"
          placeholder="What should I cook tonight?"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          className="h-11 rounded-xl bg-surface"
        />
        <Button type="submit" size="icon" className="size-11 shrink-0" disabled={!text.trim()} aria-label="Ask">
          <Send />
        </Button>
      </form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto py-1 md:flex-wrap md:overflow-visible md:py-0">
        {STARTERS.map((s) => (
          <Button key={s} variant="outline" size="sm" className="shrink-0 whitespace-nowrap bg-surface" onClick={() => ask(s)}>{s}</Button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-4 border-t border-primary/15 pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Continue a chat</p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {recent.map((t) => (
              <li key={t.id} className="min-w-0">
                <Link href={`/assistant?thread=${t.id}`} className="flex min-w-0 items-center gap-2 rounded-lg py-1 hover:text-primary-text">
                  <MessageCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate" title={t.title}>{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

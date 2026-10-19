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
  "What does “fold in” mean?",
]

/** Home card: a question typed or picked here opens a new chat on the Assistant page. */
export function AskPantrio() {
  const router = useRouter()
  const [text, setText] = useState("")
  const { data: threads } = useChats()
  const recent = threads?.slice(0, 3) ?? []

  function ask(message: string) {
    if (message.trim()) router.push(`/assistant?q=${encodeURIComponent(message.trim())}`)
  }

  return (
    <Panel className="bg-primary-soft">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold leading-[26px]">Ask Pantrio</h2>
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
          aria-label="Ask Pantrio"
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
      <div className="mt-3 flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <Button key={s} variant="outline" size="sm" className="bg-surface" onClick={() => ask(s)}>{s}</Button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-4 border-t border-primary/15 pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Continue a chat</p>
          <ul className="grid gap-1">
            {recent.map((t) => (
              <li key={t.id}>
                <Link href={`/assistant?thread=${t.id}`} className="flex items-center gap-2 rounded-lg py-1 hover:text-primary-text">
                  <MessageCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

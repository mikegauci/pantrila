"use client"

import { BadgeCheck, Smartphone } from "lucide-react"

import type { Feature } from "@pantrila/core/types"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useProRequired } from "@/lib/pro"

const USED_UP: Record<Feature, string> = {
  plan: "You have used this week's free meal plan.",
  chat: "You have used today's free assistant messages.",
  import: "You have used this month's free recipe imports.",
  photo: "AI recipe photos come with Pantrila Pro.",
}

const PRO_GIVES = [
  "5 meal plans a day",
  "20 recipe imports a day, from links, posts, photos or text",
  "50 assistant messages a day",
  "AI photos for your own recipes",
]

/** "Get Pantrila Pro in the app": Pro is sold in the iPhone and Android apps only (no web checkout),
 *  and Pro bought there counts here too. Opened by `askForPro` at a Free cap. */
export function ProSheet() {
  const [asked, close] = useProRequired()
  const resets = asked && asked.feature !== "photo"
    ? new Date(asked.resets_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : null
  return (
    <Sheet open={!!asked} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="gap-4 overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Get Pantrila Pro in the app</SheetTitle>
          <SheetDescription>
            {asked && USED_UP[asked.feature]}
            {resets && ` It comes back on ${resets}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="rounded-2xl bg-primary-soft p-4">
          <p className="font-semibold">Pantrila Pro</p>
          <p className="text-[13px] text-muted-foreground">€4.99 a month or €29.99 a year, with a 7-day free trial.</p>
          <ul className="mt-3 grid gap-2">
            {PRO_GIVES.map((g) => (
              <li key={g} className="flex gap-2 text-[14px]">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden /> {g}
              </li>
            ))}
          </ul>
        </div>
        <p className="flex gap-2 text-[13px] text-muted-foreground">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          Pro is sold in the Pantrila apps for iPhone and Android, coming soon to the App Store and
          Google Play. Sign in there with this account and Pro works here too.
        </p>
        <p className="text-[13px] text-muted-foreground">
          Browsing, search, cooking mode, your pantry, grocery list and My recipes stay free.
        </p>
        <Button variant="outline" onClick={close}>Not now</Button>
      </SheetContent>
    </Sheet>
  )
}

export function ProBadge() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary px-2 text-[11px] font-semibold text-primary-foreground">
      Pro
    </span>
  )
}

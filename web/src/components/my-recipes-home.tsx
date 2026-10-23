"use client"

import { ArrowRight, BookOpen, Link2, Share2 } from "lucide-react"
import Link from "next/link"

import { Panel, RecipeArt } from "@/components/bits"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCookbook } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const SHOWN = 4

/** Home card: the person's latest cookbook recipes and the two imports worth pushing. */
export function MyRecipesHome() {
  const { data, isLoading } = useCookbook()
  const recent = data?.slice(0, SHOWN) ?? []
  const empty = !isLoading && recent.length === 0

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link href="/recipes/mine/new?method=post" className={buttonVariants({ size: "lg" })}>
        <Share2 /> Import from a post
      </Link>
      <Link href="/recipes/mine/new?method=link" className={buttonVariants({ variant: "outline", size: "lg", className: "bg-surface" })}>
        <Link2 /> From a recipe link
      </Link>
    </div>
  )

  return (
    <Panel className={cn("min-w-0", empty && "bg-yellow-soft")} data-tour="my-recipes-home">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold leading-[26px]">My recipes</h2>
        {data && data.length > 0 && (
          <span className="tabular text-[13px] text-muted-foreground">{data.length} saved</span>
        )}
        {!empty && (
          <Link href="/recipes/mine" className={buttonVariants({ variant: "ghost", size: "sm", className: "ml-auto" })}>
            See all <ArrowRight />
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: SHOWN }, (_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}
        </div>
      ) : empty ? (
        <div className="mb-4 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface">
            <BookOpen className="size-5 text-[#b7860b]" strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-muted-foreground">
            Saw a recipe on TikTok, Instagram or Facebook, or on any recipe site? Paste the link:
            Pantrila reads the ingredients and method, credits the creator and checks it against
            your allergies and diet.
          </p>
        </div>
      ) : (
        <ul className="no-scrollbar -mx-5 mb-4 flex gap-3 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
          {recent.map((r) => (
            <li key={r.id} className="w-36 shrink-0 sm:w-auto">
              <Link href={`/recipes/mine/${r.id}`} className="group block">
                <RecipeArt
                  meal={r.meal_types[0]} cuisine={r.cuisine || undefined} photo={r.photo_url}
                  sizes="(min-width: 640px) 220px, 144px" className="aspect-[4/3] w-full"
                />
                <p className="mt-2 line-clamp-2 text-[14px] font-semibold leading-5 group-hover:text-primary-text">{r.title}</p>
                <p className="tabular text-[12px] text-muted-foreground">{r.total_minutes} min</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && actions}
    </Panel>
  )
}

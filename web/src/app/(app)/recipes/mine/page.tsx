"use client"

import { ArrowLeft, BookOpen, Clock, Flame, Plus, TriangleAlert } from "lucide-react"
import Link from "next/link"

import { AiBadge, DietBadge, EmptyState, RecipeArt } from "@/components/bits"
import { RECIPE_SOURCE } from "@/components/cookbook-form"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCookbook } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { CookbookCard } from "@/lib/types"

function Card({ r }: { r: CookbookCard }) {
  const unsafe = r.problems.length > 0
  const { icon: Icon, text } = RECIPE_SOURCE[r.source]
  return (
    <Link
      href={`/recipes/mine/${r.id}`}
      className={cn(
        "group flex flex-col rounded-[20px] border bg-surface p-3 transition-shadow duration-150 ease-out hover:shadow-soft",
        unsafe && "border-danger/50",
      )}
    >
      <RecipeArt meal={r.meal_types[0]} cuisine={r.cuisine || undefined} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-[22px] group-hover:text-primary-text">{r.title}</h3>
        <p className="tabular flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{r.total_minutes} min</span>
          {r.nutrition && (
            <span className="inline-flex items-center gap-1"><Flame className="size-3.5" aria-hidden />{Math.round(r.nutrition.kcal)} kcal</span>
          )}
          <span className="inline-flex items-center gap-1"><Icon className="size-3.5" aria-hidden />{text}</span>
        </p>
        {unsafe && (
          <p className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-[12px] font-medium text-white">
            <TriangleAlert className="size-3" aria-hidden /> Not for you: {r.problems.join("; ")}
          </p>
        )}
        {r.invalid.length > 0 && (
          <p className="text-[12px] text-[#a65a00]">Needs a fix before nutrition can be shown.</p>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {r.estimated && <AiBadge>Estimated</AiBadge>}
          {r.diet_tags.slice(0, 3).map((d) => <DietBadge key={d} diet={d} />)}
        </div>
      </div>
    </Link>
  )
}

export default function MyRecipesPage() {
  const { data, error, isLoading } = useCookbook()
  const add = (
    <Link href="/recipes/mine/new" className={buttonVariants({ size: "lg" })}>
      <Plus /> Add a recipe
    </Link>
  )
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/recipes" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft /> Recipes
          </Link>
          <h2 className="text-[18px] font-semibold">My recipes</h2>
        </div>
        {add}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Recipes you add from a photo, a link or by typing them in. Only you can see them. Nutrition,
        allergens and diets are worked out from the ingredients, as for every Pantrio recipe; they are
        not used in meal plans.
      </p>
      {error ? (
        <p role="alert" className="text-danger">{error.message}</p>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-[20px]" />)}
        </div>
      ) : data?.length ? (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
          {data.map((r) => <Card key={r.id} r={r} />)}
        </div>
      ) : (
        <EmptyState icon={BookOpen} title="No recipes of your own yet" action={add}>
          Snap a cookbook page, paste a link from a recipe site, or type a family favourite.
        </EmptyState>
      )}
    </div>
  )
}

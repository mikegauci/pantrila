import { Clock, Flame, Refrigerator, TriangleAlert } from "lucide-react"
import Link from "next/link"

import { DietBadge, RecipeArt } from "@/components/bits"
import { cn } from "@/lib/utils"
import type { RecipeCard as Recipe } from "@/lib/types"

export function RecipeCard({ recipe, className }: { recipe: Recipe; className?: string }) {
  const unsafe = recipe.problems.length > 0
  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className={cn(
        "group flex flex-col rounded-[20px] border bg-surface p-3 transition-shadow duration-150 ease-out hover:shadow-soft",
        unsafe && "border-danger/50",
        className,
      )}
    >
      <RecipeArt
        meal={recipe.meal_types[0]} cuisine={recipe.cuisine} photo={recipe.photo_url}
        sizes="(min-width: 1280px) 280px, (min-width: 768px) 33vw, (min-width: 420px) 50vw, 100vw"
        className="aspect-[4/3] w-full"
      />
      <div className="flex flex-1 flex-col gap-2 px-1 pt-3 pb-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-[22px] group-hover:text-primary-text">
          {recipe.title}
        </h3>
        <p className="tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock className="size-3.5" aria-hidden />{recipe.total_minutes} min</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><Flame className="size-3.5" aria-hidden />{Math.round(recipe.nutrition.kcal)} kcal</span>
          <span className="whitespace-nowrap">{Math.round(recipe.nutrition.protein_g)} g protein</span>
        </p>
        {unsafe && (
          <p className="inline-flex items-center gap-1 rounded-full bg-danger px-2.5 py-0.5 text-[12px] font-medium text-white">
            <TriangleAlert className="size-3" aria-hidden /> Not for you: {recipe.problems.join("; ")}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {recipe.pantry_foods.length > 0 && (
            <span className="inline-flex min-h-6 items-center gap-1 rounded-2xl bg-primary-soft px-2.5 py-0.5 text-[12px] leading-4 font-medium text-primary-text">
              <Refrigerator className="size-3" aria-hidden />
              Uses {recipe.pantry_foods.length} of your pantry items
            </span>
          )}
          {recipe.diet_tags.slice(0, 3).map((d) => <DietBadge key={d} diet={d} />)}
        </div>
      </div>
    </Link>
  )
}

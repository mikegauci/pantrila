"use client"

import { useParams } from "next/navigation"

import { CookingMode } from "@/components/cooking-mode"
import { Skeleton } from "@/components/ui/skeleton"
import { useCookbookRecipe } from "@/lib/hooks"

export default function CookMyRecipePage() {
  const { id } = useParams<{ id: string }>()
  const { data: r, error, isLoading } = useCookbookRecipe(id)

  if (error) {
    return <p role="alert" className="text-danger">{error.status === 404 ? "No such recipe in your cookbook." : error.message}</p>
  }
  if (isLoading || !r) return <Skeleton className="h-96 rounded-[20px]" />
  return (
    <CookingMode recipe={{
      key: `mine:${r.id}`, title: r.title, servings: r.servings, ingredients: r.ingredients,
      steps: r.steps, stepSections: r.step_sections, source: { cookbook_id: r.id }, backHref: `/recipes/mine/${r.id}`,
    }} />
  )
}

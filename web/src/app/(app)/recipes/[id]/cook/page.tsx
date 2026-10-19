"use client"

import { useParams } from "next/navigation"

import { CookingMode } from "@/components/cooking-mode"
import { Skeleton } from "@/components/ui/skeleton"
import { useRecipe } from "@/lib/hooks"

export default function CookRecipePage() {
  const { id } = useParams<{ id: string }>()
  const { data: r, error, isLoading } = useRecipe(id)

  if (error) {
    return <p role="alert" className="text-danger">{error.status === 404 ? "No such recipe." : error.message}</p>
  }
  if (isLoading || !r) return <Skeleton className="h-96 rounded-[20px]" />
  return (
    <CookingMode recipe={{
      key: `corpus:${r.id}`, title: r.title, servings: r.servings, ingredients: r.ingredients,
      steps: r.steps, source: { recipe_id: r.id }, backHref: `/recipes/${r.id}`,
    }} />
  )
}

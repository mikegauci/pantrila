import { label } from "@/lib/format"
import type { MealType, Plan, PlanMeal } from "@/lib/types"

/** Rough energy for eating out, offered as one tap each; "Don't count" leaves it unknown. */
export const EATING_OUT_SIZES = [
  { label: "Light meal", kcal: 500 },
  { label: "Normal meal", kcal: 800 },
  { label: "Big meal", kcal: 1200 },
] as const

/** True when the meal's recipe is eaten (cooked there or as leftovers). */
export const eatsRecipe = (m: PlanMeal) => m.kind === "recipe" || m.kind === "leftovers"

/** Where a plan meal's recipe opens: the cookbook for the person's own recipes. */
export function mealHref(m: PlanMeal): string | null {
  if (!m.recipe) return null
  return m.cookbook_id != null ? `/recipes/mine/${m.cookbook_id}` : `/recipes/${m.recipe.id}`
}

/** Energy the meal adds to its day, or null when it is not known (eating out, no estimate). */
export function mealKcal(m: PlanMeal): number | null {
  if (m.kind === "skipped") return 0
  if (m.kind === "eating_out") return m.out_kcal
  return m.recipe ? m.recipe.nutrition.kcal * m.portions : null
}

export interface LeftoverSource {
  day: number
  meal: MealType
  title: string
}

/** Meals cooked on days before `day`, which this meal could be leftovers of. */
export function leftoverSources(plan: Plan, day: number): LeftoverSource[] {
  return plan.days
    .filter((d) => d.day < day)
    .flatMap((d) => d.meals
      .filter((m) => m.kind === "recipe" && m.recipe)
      .map((m) => ({ day: d.day, meal: m.meal_type, title: m.recipe!.title })))
}

/** Meals that are leftovers of the one at (day, meal); it must stay cooked while they exist. */
export function leftoversOf(plan: Plan, day: number, meal: MealType): string[] {
  return plan.days.flatMap((d) => d.meals
    .filter((m) => m.kind === "leftovers" && m.from_day === day && m.from_meal === meal)
    .map((m) => `day ${d.day} ${m.meal_type}`))
}

export interface RepeatChoice {
  day: number
  meal: MealType
  /** What the meal is now: a recipe title, "Skipped" or "Eating out". */
  now: string
  /** Already leftovers of this meal. */
  already: boolean
  /** Why it cannot become leftovers of this meal, if it cannot. */
  blocked: string | null
}

/** Meals on later days that the meal at (day, meal) could be repeated on, in plan order. */
export function repeatChoices(plan: Plan, day: number, meal: MealType): RepeatChoice[] {
  return plan.days.filter((d) => d.day > day).flatMap((d) => d.meals.map((m) => {
    const already = m.kind === "leftovers" && m.from_day === day && m.from_meal === meal
    const kept = leftoversOf(plan, d.day, m.meal_type)
    const now = m.kind === "skipped" ? "Skipped" : m.kind === "eating_out" ? "Eating out"
      : m.recipe?.title ?? label(m.meal_type)
    return {
      day: d.day, meal: m.meal_type, now, already,
      blocked: kept.length ? `${kept.join(", ")} ${kept.length === 1 ? "is" : "are"} leftovers of it` : null,
    }
  }))
}

/** Portions to cook for a meal per person: its own plus every meal that eats its leftovers. */
export function cookPortions(plan: Plan, day: number, meal: MealType): { total: number; later: number } {
  const own = plan.days.find((d) => d.day === day)?.meals.find((m) => m.meal_type === meal)
  const later = plan.days.flatMap((d) => d.meals)
    .filter((m) => m.kind === "leftovers" && m.from_day === day && m.from_meal === meal)
    .reduce((sum, m) => sum + m.portions, 0)
  return { total: (own?.portions ?? 0) + later, later }
}

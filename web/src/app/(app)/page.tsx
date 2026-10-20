"use client"

import { ArrowRight, CalendarDays, Refrigerator, ShoppingBasket } from "lucide-react"
import Link from "next/link"

import { AskPantrila } from "@/components/ask-pantrila"
import { EmptyState, Panel, PanelTitle, ProblemAlert, RecipeArt } from "@/components/bits"
import { MacroRing } from "@/components/macro-ring"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth-provider"
import { label, planDayIndex } from "@/lib/format"
import { useGrocery, usePantry, usePlan } from "@/lib/hooks"
import { firstName } from "@/lib/supabase"

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

export default function HomePage() {
  const { session } = useAuth()
  const { data: plan, isLoading } = usePlan()
  const { data: pantry } = usePantry()
  const { data: grocery } = useGrocery(1, !!plan)
  const name = firstName(session?.user) ?? session?.user.email?.split("@")[0]

  const dayIndex = plan ? planDayIndex(plan.created_at, plan.days.length) : 0
  const today = plan?.days[dayIndex]

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-[28px] font-bold leading-9">
          {greeting()}{name ? `, ${name}` : ""}
        </p>
        <p className="text-muted-foreground">Here is what is cooking today.</p>
      </div>

      <AskPantrila />

      {plan && (
        <ProblemAlert
          title="Your plan no longer fits your profile"
          items={plan.problems.map((p) => `Day ${p.day} ${p.meal_type}: ${p.message}. Generate a new plan.`)}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelTitle
            action={
              plan && (
                <Link href="/plan" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Full week <ArrowRight />
                </Link>
              )
            }
          >
            {plan ? `Today's meals · day ${dayIndex + 1} of ${plan.days.length}` : "Today's meals"}
          </PanelTitle>
          {isLoading ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : today ? (
            <ul className="grid gap-3 sm:grid-cols-3">
              {today.meals.map((m) => (
                <li key={m.meal_type}>
                  <Link href={`/recipes/${m.recipe.id}`} className="group flex items-center gap-3 rounded-2xl border p-3 hover:shadow-soft sm:block">
                    <RecipeArt
                      meal={m.meal_type} photo={m.recipe.photo_url} sizes="(min-width: 640px) 340px, 64px"
                      className="size-16 shrink-0 sm:mb-3 sm:aspect-[4/3] sm:size-auto"
                    />
                    <div className="min-w-0">
                    <p className="text-[12px] font-medium text-muted-foreground">{label(m.meal_type)}</p>
                    <p className="line-clamp-2 font-semibold group-hover:text-primary-text">{m.recipe.title}</p>
                    <p className="tabular text-[12px] text-muted-foreground">
                      {Math.round(m.recipe.nutrition.kcal * m.portions)} kcal · {m.portions} serving{m.portions === 1 ? "" : "s"}
                    </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="No meal plan yet"
              action={<Link href="/plan" className={buttonVariants({ size: "lg" })}>Plan my week</Link>}
            >
              Pantrila picks a week of recipes that respects your allergies and diet, uses your pantry
              first and aims at your nutrition targets.
            </EmptyState>
          )}
        </Panel>

        <Panel>
          <PanelTitle>Today&apos;s nutrition</PanelTitle>
          {today ? (
            <MacroRing nutrition={today.nutrition} target={plan?.targets.kcal} size={150} />
          ) : (
            <p className="text-muted-foreground">
              Macros (protein, carbs and fat) for the day show here once you have a plan.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel className="bg-orange-soft">
          <PanelTitle
            action={<Link href="/pantry" className={buttonVariants({ variant: "ghost", size: "sm" })}>Open <ArrowRight /></Link>}
          >
            Use it up
          </PanelTitle>
          {pantry?.length ? (
            <>
              <p className="mb-3 text-muted-foreground">
                {pantry.length} food{pantry.length === 1 ? "" : "s"} in your pantry. Plans and recipe
                search use them first.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pantry.slice(0, 10).map((i) => (
                  <span key={i.key} className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium">
                    {i.name}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <Refrigerator className="size-5 shrink-0 text-[#a65a00]" aria-hidden />
              <p>Tell Pantrila what is in your kitchen and it will plan around it.</p>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelTitle
            action={plan && <Link href="/grocery" className={buttonVariants({ variant: "ghost", size: "sm" })}>All <ArrowRight /></Link>}
          >
            To buy
          </PanelTitle>
          {grocery ? (
            <ul className="grid gap-2">
              {grocery.items.slice(0, 5).map((i) => (
                <li key={i.food} className="flex justify-between gap-3">
                  <span>{label(i.food)}</span>
                  <span className="tabular text-muted-foreground">{i.amount}</span>
                </li>
              ))}
              {grocery.items.length > 5 && (
                <li className="text-[12px] text-muted-foreground">and {grocery.items.length - 5} more</li>
              )}
              {!grocery.items.length && <li className="text-muted-foreground">Your pantry covers the whole plan.</li>}
            </ul>
          ) : (
            <div className="flex items-start gap-3">
              <ShoppingBasket className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-muted-foreground">Your grocery list comes from your meal plan.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

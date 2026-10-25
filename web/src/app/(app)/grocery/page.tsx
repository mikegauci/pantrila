"use client"

import { Minus, Plus, ShoppingBasket } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { label } from "@pantrila/core/format"
import type { GroceryItem } from "@pantrila/core/types"

import { useAuth } from "@/components/auth-provider"
import { EmptyState, Panel, PanelTitle } from "@/components/bits"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useGrocery, usePlan } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const AISLES: Record<string, string> = { nuts_seeds: "Nuts and seeds", oils_condiments: "Oils and condiments" }

function byAisle(items: GroceryItem[]) {
  const groups: [string, GroceryItem[]][] = []
  for (const i of items) {
    const last = groups.at(-1)
    if (last && last[0] === i.aisle) last[1].push(i)
    else groups.push([i.aisle, [i]])
  }
  return groups
}

export default function GroceryPage() {
  const { session } = useAuth()
  const { data: plan, isLoading: planLoading } = usePlan()
  const [people, setPeople] = useState(1)
  const { data, isLoading } = useGrocery(people, !!plan)
  // Ticks per plan, kept in this browser. The app renders only after sign-in on the client,
  // so reading localStorage during render is safe.
  const [edits, setEdits] = useState<Record<string, string[]>>({})
  const storageKey = plan ? `pantrila-grocery-${session!.user.id}-${plan.id}` : null
  const ticked = new Set(
    storageKey
      ? edits[storageKey] ?? (JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[])
      : [],
  )

  function toggle(food: string) {
    if (!storageKey) return
    const next = new Set(ticked)
    if (next.has(food)) next.delete(food)
    else next.add(food)
    setEdits({ ...edits, [storageKey]: [...next] })
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  }

  const titles = new Map(plan?.days.flatMap((d) => d.meals.flatMap((m) => m.recipe ? [[m.recipe.id, m.recipe.title] as const] : [])))

  if (planLoading) return <Skeleton className="h-96 rounded-[20px]" />
  if (!plan) {
    return (
      <Panel>
        <EmptyState icon={ShoppingBasket} title="No grocery list yet"
                    action={<Link href="/plan" className={buttonVariants({ size: "lg" })}>Plan my week</Link>}>
          Your list is built from your meal plan, minus what is already in your pantry.
        </EmptyState>
      </Panel>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Panel>
        <PanelTitle
          action={
            <div className="flex items-center gap-2" aria-label="People">
              <Button variant="outline" size="icon-sm" aria-label="Fewer people" onClick={() => setPeople(Math.max(1, people - 1))}><Minus /></Button>
              <span className="tabular w-20 text-center text-[13px] font-semibold">{people} {people === 1 ? "person" : "people"}</span>
              <Button variant="outline" size="icon-sm" aria-label="More people" onClick={() => setPeople(Math.min(12, people + 1))}><Plus /></Button>
            </div>
          }
        >
          To buy
        </PanelTitle>
        {isLoading || !data ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : !data.items.length ? (
          <p className="text-muted-foreground">Your pantry covers the whole plan. Nothing to buy.</p>
        ) : (
          <div className="grid gap-5">
            <p className="text-[12px] text-muted-foreground">
              {data.items.length} items for {plan.days.length} days, rounded up to shop amounts.
              {ticked.size > 0 && ` ${data.items.filter((i) => ticked.has(i.food)).length} in the basket.`}
            </p>
            {byAisle(data.items).map(([aisle, items]) => (
              <section key={aisle}>
                <h3 className="mb-2 text-[15px] font-semibold">{AISLES[aisle] ?? label(aisle)}</h3>
                <ul>
                  {items.map((i) => (
                    <li key={i.food} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                      <Checkbox id={`g-${i.food}`} checked={ticked.has(i.food)} onCheckedChange={() => toggle(i.food)} />
                      <label htmlFor={`g-${i.food}`} className={cn("flex-1 cursor-pointer", ticked.has(i.food) && "text-muted-foreground line-through")}>
                        <span className="font-medium">{label(i.food)}</span>
                        <span className="block text-[12px] text-muted-foreground">
                          for {i.recipes.map((r) => titles.get(r) ?? r).join(", ")}
                          {i.have_g > 0 && ` · you have ${Math.round(i.have_g)} g`}
                        </span>
                      </label>
                      <span className="tabular font-semibold">{i.amount}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {data.unlisted && data.unlisted.length > 0 && (
              <section>
                <h3 className="mb-1 text-[15px] font-semibold">Also for your recipes</h3>
                <p className="mb-2 text-[12px] text-muted-foreground">
                  Pantrila estimated these foods, so it cannot say how much to buy. Check the recipe.
                </p>
                <ul className="flex flex-wrap gap-2">
                  {data.unlisted.map((name) => (
                    <li key={name} className="rounded-full border px-3 py-1 text-[13px]">{name}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Panel>

      <Panel className="h-fit bg-primary-soft">
        <PanelTitle>From your pantry</PanelTitle>
        {data?.covered.length ? (
          <ul className="grid gap-2">
            {data.covered.map((i) => (
              <li key={i.food} className="flex justify-between gap-3 text-muted-foreground line-through decoration-primary">
                <span>{label(i.food)}</span>
                <span className="tabular">{i.amount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            Nothing in your <Link href="/pantry" className="underline">pantry</Link> covers this plan yet.
          </p>
        )}
      </Panel>
    </div>
  )
}

"use client"

import { Plus, Refrigerator, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { label } from "@pantrila/core/format"
import type { PantryItem, Unit } from "@pantrila/core/types"

import { EmptyState, Panel, PanelTitle } from "@/components/bits"
import { NativeSelect } from "@/components/native-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, send } from "@/lib/api"
import { useFoods, usePantry, useRefreshKitchen } from "@/lib/hooks"

const UNITS: Unit[] = ["g", "kg", "ml", "l", "piece", "tbsp", "tsp", "cup"]

export default function PantryPage() {
  const { data: items, isLoading } = usePantry()
  const refreshKitchen = useRefreshKitchen()
  const { data: foods } = useFoods()
  const [food, setFood] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState<Unit>("g")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function add(name = food) {
    if (!name.trim()) return
    setBusy(true)
    setSuggestions([])
    try {
      const q = quantity ? Number(quantity) : null
      const item = await send<PantryItem>("/me/pantry", "POST", { food: name, quantity: q, unit: q ? unit : null })
      await refreshKitchen()
      toast.success(`Added ${item.name}`)
      setFood("")
      setQuantity("")
    } catch (e) {
      if (e instanceof ApiError) {
        setSuggestions(e.suggestions)
        toast.error(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: PantryItem) {
    try {
      await send(`/me/pantry/${item.key}`, "DELETE")
      await refreshKitchen()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that food.")
    }
  }

  const groups = new Map<string, PantryItem[]>()
  for (const i of items ?? []) groups.set(i.aisle, [...(groups.get(i.aisle) ?? []), i])

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Panel className="h-fit">
        <PanelTitle>Add to your pantry</PanelTitle>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="food">Food</Label>
            <Input id="food" list="foods" required placeholder="e.g. eggs, spinach, greek yogurt"
                   value={food} onChange={(e) => setFood(e.target.value)} className="h-10" />
            <datalist id="foods">
              {foods?.map((f) => <option key={f.key} value={f.name} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="qty">Amount <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="qty" type="number" min="0" step="any" inputMode="decimal" value={quantity}
                     onChange={(e) => setQuantity(e.target.value)} className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unit">Unit</Label>
              <NativeSelect id="unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="w-24">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </NativeSelect>
            </div>
          </div>
          <Button type="submit" disabled={busy}><Plus /> Add</Button>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              Did you mean
              {suggestions.map((s) => (
                <Button key={s} type="button" variant="outline" size="xs" onClick={() => { setFood(label(s)); add(s) }}>
                  {label(s)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-[12px] text-muted-foreground">
            No amount means “some”, enough for any recipe. Amounts are turned into grams so the
            grocery list can subtract them.
          </p>
        </form>
      </Panel>

      <Panel>
        <PanelTitle>In your kitchen {items?.length ? <span className="text-muted-foreground">· {items.length}</span> : null}</PanelTitle>
        {isLoading ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : !items?.length ? (
          <EmptyState icon={Refrigerator} title="Your pantry is empty">
            Add what you have and Pantrila will plan meals that use it up first.
          </EmptyState>
        ) : (
          <div className="grid gap-5">
            {[...groups].map(([aisle, list]) => (
              <section key={aisle}>
                <h3 className="mb-1 text-[15px] font-semibold">{label(aisle)}</h3>
                <ul>
                  {list.map((i) => (
                    <li key={i.key} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                      <span className="flex-1 font-medium">{label(i.name)}</span>
                      <span className="tabular text-muted-foreground">
                        {i.quantity != null ? `${i.quantity} ${i.unit}` : "some"}
                        {i.grams != null && i.unit !== "g" ? ` · ${Math.round(i.grams)} g` : ""}
                      </span>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i.name}`} onClick={() => remove(i)}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

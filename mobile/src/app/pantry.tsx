import { Plus, Refrigerator, X } from "lucide-react-native"
import { useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"

import { label } from "@pantrila/core/format"
import type { PantryItem, Unit } from "@pantrila/core/types"

import { Button, EmptyState, ErrorState, Panel, PanelTitle } from "@/components/bits"
import { ChipRow } from "@/components/chips"
import { INPUT } from "@/components/form"
import { Icon } from "@/components/icon"
import { ApiError, send } from "@/lib/api"
import { useFoods, usePantry, useRefreshKitchen } from "@/lib/hooks"
import { toast } from "@/lib/toast"

const UNITS: Unit[] = ["g", "kg", "ml", "l", "piece", "tbsp", "tsp", "cup"]

const amountText = (i: PantryItem) =>
  (i.quantity != null ? `${i.quantity} ${i.unit}` : "some") + (i.grams != null && i.unit !== "g" ? ` · ${Math.round(i.grams)} g` : "")

/** What is in the kitchen (the web's Pantry page): add a food with an optional amount, tap one to
 * change its amount, remove it. Foods match the ingredient table; a near miss offers "Did you mean". */
export default function Pantry() {
  const { data: items, error, isLoading, mutate } = usePantry()
  const { data: foods } = useFoods()
  const refreshKitchen = useRefreshKitchen()
  const [food, setFood] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState<Unit>("g")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Foods from the table that start with (else contain) what is typed, as the web's datalist offers.
  const matches = useMemo(() => {
    const q = food.trim().toLowerCase()
    if (q.length < 2 || !foods) return []
    const named = (f: { name: string }) => f.name.toLowerCase()
    const starts = foods.filter((f) => named(f).startsWith(q))
    const inside = foods.filter((f) => !named(f).startsWith(q) && named(f).includes(q))
    return [...starts, ...inside].filter((f) => named(f) !== q).slice(0, 6)
  }, [food, foods])

  async function add(name = food) {
    if (!name.trim()) return
    setBusy(true)
    setSuggestions([])
    try {
      const q = quantity.trim() ? Number(quantity.replace(",", ".")) : null
      const item = await send<PantryItem>("/me/pantry", "POST", { food: name, quantity: q, unit: q ? unit : null })
      await refreshKitchen()
      toast.success(`Added ${label(item.name)}`)
      setFood("")
      setQuantity("")
    } catch (e) {
      if (e instanceof ApiError) setSuggestions(e.suggestions)
      toast.error(e instanceof Error ? e.message : "Could not add that food.")
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

  function edit(item: PantryItem) {
    setFood(label(item.name))
    setQuantity(item.quantity != null ? String(item.quantity) : "")
    if (item.unit) setUnit(item.unit)
    setSuggestions([])
  }

  const groups = new Map<string, PantryItem[]>()
  for (const i of items ?? []) groups.set(i.aisle, [...(groups.get(i.aisle) ?? []), i])

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={false} onRefresh={() => { mutate() }} />}>
      <Panel>
        <PanelTitle>Add to your pantry</PanelTitle>
        <View className="gap-3">
          <View className="gap-1.5">
            <Text className="font-sans-medium text-sm text-foreground">Food</Text>
            <TextInput accessibilityLabel="Food" placeholder="e.g. eggs, spinach, greek yogurt"
                       placeholderTextColorClassName="accent-muted-foreground" autoCapitalize="none" autoCorrect={false}
                       returnKeyType="done" onSubmitEditing={() => add()}
                       value={food} onChangeText={(t) => { setFood(t); setSuggestions([]) }} className={`${INPUT} h-11`} />
            {matches.length > 0 && (
              <View className="flex-row flex-wrap gap-1.5">
                {matches.map((f) => (
                  <Pressable key={f.key} accessibilityRole="button" accessibilityLabel={`Pick ${label(f.name)}`}
                             onPress={() => setFood(label(f.name))}
                             className="h-8 justify-center rounded-full bg-surface-muted px-3">
                    <Text className="font-sans-medium text-[13px] text-foreground">{label(f.name)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          <View className="gap-1.5">
            <Text className="font-sans-medium text-sm text-foreground">
              Amount <Text className="font-sans text-muted-foreground">(optional)</Text>
            </Text>
            <TextInput accessibilityLabel="Amount" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity}
                       className={`${INPUT} h-11`} />
          </View>
          <ChipRow name="Unit" options={UNITS.map((u) => ({ value: u, label: u }))} selected={[unit]} single
                   onChange={(next) => next[0] && setUnit(next[0])} />
          <Button text={busy ? "Adding…" : "Add"} icon={Plus} busy={busy} onPress={() => add()} />
          {suggestions.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-sans text-[13px] text-foreground">Did you mean</Text>
              {suggestions.map((s) => (
                <Button key={s} text={label(s)} variant="outline" size="sm" onPress={() => { setFood(label(s)); add(s) }} />
              ))}
            </View>
          )}
          <Text className="font-sans text-xs text-muted-foreground">
            No amount means “some”, enough for any recipe. Amounts are turned into grams so the grocery list can
            subtract them. Tap a food below to change its amount.
          </Text>
        </View>
      </Panel>

      <Panel>
        <PanelTitle>{`In your kitchen${items?.length ? ` · ${items.length}` : ""}`}</PanelTitle>
        {error ? (
          <ErrorState message={error.message} onRetry={() => mutate()} />
        ) : isLoading ? (
          <Text className="font-sans text-sm text-muted-foreground">Loading your pantry…</Text>
        ) : !items?.length ? (
          <EmptyState icon={Refrigerator} title="Your pantry is empty">
            Add what you have and Pantrila will plan meals that use it up first.
          </EmptyState>
        ) : (
          <View className="gap-5">
            {[...groups].map(([aisle, list]) => (
              <View key={aisle}>
                <Text accessibilityRole="header" className="mb-1 font-sans-semibold text-[15px] text-foreground">{label(aisle)}</Text>
                {list.map((i, n) => (
                  <View key={i.key} className={`flex-row items-center gap-3 py-2.5 ${n < list.length - 1 ? "border-b border-border" : ""}`}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Change ${label(i.name)}, ${amountText(i)}`}
                               onPress={() => edit(i)} className="flex-1 flex-row items-center gap-3">
                      <Text className="flex-1 font-sans-medium text-base text-foreground">{label(i.name)}</Text>
                      <Text className="font-sans text-sm text-muted-foreground">{amountText(i)}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label(i.name)}`} hitSlop={8}
                               onPress={() => remove(i)} className="size-8 items-center justify-center rounded-full">
                      <Icon icon={X} tone="muted-foreground" size={18} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </Panel>
    </ScrollView>
  )
}

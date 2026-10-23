"use client"

import { MeasuredLine } from "@/components/amount"
import { NutritionSource } from "@/components/nutrition-source"
import { ArrowLeft, Camera, Check, ChevronDown, Clock, ExternalLink, ImageOff, Loader2, MessageCircle, Pencil, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { AllergenBadge, DietBadge, Panel, PanelTitle, ProblemAlert, RecipeArt } from "@/components/bits"
import { CookbookForm, PLATFORM, RECIPE_SOURCE, siteOf } from "@/components/cookbook-form"
import { StartCooking } from "@/components/cooking-mode"
import { MacroRing } from "@/components/macro-ring"
import { Button, buttonVariants } from "@/components/ui/button"
import { TemperatureToggle } from "@/components/temperature-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { send } from "@/lib/api"
import { label } from "@/lib/format"
import { groupLines, groupSteps } from "@/lib/sections"
import { useCookbookRecipe, useMe, useProfile } from "@/lib/hooks"
import { makePhoto, usePhotoPending } from "@/lib/photo-jobs"
import { niceFractions } from "@/lib/amounts"
import { hasTemp, showTemps, useTempUnit } from "@/lib/temperature"
import { cn } from "@/lib/utils"
import type { CookbookDetail } from "@/lib/types"

const SOURCE_LINK = "inline-flex items-center gap-1 font-medium text-primary-text underline-offset-2 hover:underline"

/** "From @creator on TikTok", with whatever parts of the credit are known. */
const noSubscribe = () => () => {}
const chatThread = () => {
  const thread = new URLSearchParams(window.location.search).get("chat")
  return thread && /^\d+$/.test(thread) ? thread : null
}

function postCredit(r: CookbookDetail) {
  const by = r.source_author ? ` @${r.source_author}` : " a post"
  return `From${by}${r.source_platform ? ` on ${PLATFORM[r.source_platform]}` : ""}`
}

export default function MyRecipePage() {
  const { id } = useParams<{ id: string }>()
  // Saved from an assistant chat: that thread's id, so the person can go back and keep refining.
  const chat = useSyncExternalStore(noSubscribe, chatThread, () => null)
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const { data: r, error, isLoading, mutate: refresh } = useCookbookRecipe(id)
  const { data: profile } = useProfile()
  const { data: me, mutate: refreshMe } = useMe()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [unit] = useTempUnit()
  const making = usePhotoPending(Number(id), Boolean(r?.photo_url), refresh)

  if (error) {
    return <p role="alert" className="text-danger">{error.status === 404 ? "No such recipe in your cookbook." : error.message}</p>
  }
  if (isLoading || !r) return <Skeleton className="h-96 rounded-[20px]" />

  if (editing) {
    return (
      <div className="grid gap-5">
        <h2 className="text-[18px] font-semibold">Edit {r.title}</h2>
        <CookbookForm
          initial={r.recipe}
          recipeId={r.id}
          onSaved={(saved) => {
            refresh(saved, { revalidate: false })
            mutate("/me/recipes")
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  async function remove() {
    if (!r || !window.confirm(`Delete ${r.title} from your recipes?`)) return
    try {
      await send(`/me/recipes/${r.id}`, "DELETE")
      toast.success(`Deleted ${r.title}`)
      mutate("/me/recipes")
      router.push("/recipes/mine")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.")
    }
  }

  async function photo(action: "make" | "remove") {
    if (!r) return
    if (action === "remove" && !window.confirm("Remove this photo?")) return
    if (action === "remove") setRemoving(true)
    try {
      const saved = action === "make" ? await makePhoto(r.id) : await send<typeof r>(`/me/recipes/${r.id}/photo`, "DELETE")
      refresh(saved, { revalidate: false })
      mutate("/me/recipes")
      refreshMe()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the photo.")
    } finally {
      setRemoving(false)
    }
  }

  const photosLeft = me?.limits.photos_left
  const allergies = new Set(profile?.allergies ?? [])
  const { icon: SourceIcon, text: sourceText } = RECIPE_SOURCE[r.source]
  const have = r.ingredients.filter((i) => i.in_pantry).length

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Link href="/recipes/mine" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}>
            <ArrowLeft /> My recipes
          </Link>
          {chat && (
            <Link href={`/assistant?thread=${chat}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}>
              <MessageCircle /> Back to the chat
            </Link>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
          <Button variant="outline" size="sm" onClick={remove}><Trash2 /> Delete</Button>
        </div>
      </div>

      <ProblemAlert title="This recipe does not suit you" items={r.problems} />
      <ProblemAlert title="This recipe needs a fix (edit it)" items={r.invalid} />

      <Panel className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          <RecipeArt
            meal={r.meal_types[0]} cuisine={r.cuisine || undefined} size="lg" photo={r.photo_url} making={making}
            sizes="(min-width: 768px) 440px, 100vw" className="aspect-[4/3] w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline" size="sm" onClick={() => photo("make")}
              disabled={making || removing || photosLeft === 0}
            >
              {making ? <Loader2 className="animate-spin" /> : <Camera />}
              {making ? "Making a photo…" : r.photo_url ? "New photo" : "Generate photo"}
            </Button>
            {r.photo_url && (
              <Button variant="ghost" size="sm" onClick={() => photo("remove")} disabled={making || removing}>
                <ImageOff /> Remove
              </Button>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            An AI photo made from this recipe&apos;s own ingredients, about 15 seconds.
            {me && ` ${me.limits.photos_left} of ${me.limits.photos_per_day} left today.`}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-[24px] font-bold leading-8">{r.title}</h2>
          {r.summary && <p className="text-muted-foreground">{r.summary}</p>}
          <p className="tabular flex flex-wrap gap-4 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock className="size-4" aria-hidden />{r.total_minutes} min</span>
            <span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden />Serves {r.servings}</span>
            <span>{r.meal_types.map(label).join(", ")}</span>
          </p>
          {r.source === "post" ? (
            <div className="grid gap-1 text-[13px] text-muted-foreground">
              <p className="inline-flex flex-wrap items-center gap-1.5">
                <SourceIcon className="size-4" aria-hidden />
                {r.source_url ? (
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK}>
                    {postCredit(r)} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : postCredit(r)}
              </p>
              {r.recipe_url && (
                <p className="inline-flex flex-wrap items-center gap-1.5 pl-[22px]">
                  Recipe from
                  <a href={r.recipe_url} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK}>
                    {siteOf(r.recipe_url)} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <SourceIcon className="size-4" aria-hidden /> {sourceText}
              {r.source_url && (
                <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK}>
                  {siteOf(r.source_url)} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {r.diet_tags.map((d) => <DietBadge key={d} diet={d} />)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Allergens:</span>
            {r.allergens.length
              ? r.allergens.map((a) => <AllergenBadge key={a} allergen={a} danger={allergies.has(a)} />)
              : <span className="text-[12px]">none of the 14 EU allergens</span>}
          </div>
          <div className="mt-auto pt-2">
            <StartCooking href={`/recipes/mine/${r.id}/cook`} recipeKey={`mine:${r.id}`}
                          match={{ cookbook_id: r.id }} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelTitle>Ingredients</PanelTitle>
          <p className="mb-2 text-[12px] text-muted-foreground">You have {have} of {r.ingredients.length} in your pantry.</p>
          {groupLines(r.ingredients).map((g, n) => (
            <div key={n}>
              {g.title && <h3 className="mt-4 mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>}
              <ul>
                {g.items.map(({ item: ing, index: i }) => (
                  <li key={i} className="flex items-center gap-3 border-b py-2.5 last:border-0">
                    <span
                      className={cn("grid size-5 shrink-0 place-items-center rounded-full border",
                                    ing.in_pantry ? "border-primary bg-primary text-primary-foreground" : "border-border")}
                      title={ing.in_pantry ? "In your pantry" : "Not in your pantry"}
                    >
                      {ing.in_pantry && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <MeasuredLine line={ing}>
                      {(text, picker) => (
                        <>
                          <span className="flex-1">
                            {text}
                            {ing.in_pantry && <span className="sr-only"> (in your pantry)</span>}
                            {ing.amount_estimate && (
                              <span className="mt-1 block text-[12px] text-muted-foreground">
                                Estimated amount: {ing.amount_estimate}
                              </span>
                            )}
                          </span>
                          {picker}
                        </>
                      )}
                    </MeasuredLine>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>

        <Panel>
          <PanelTitle>Per serving</PanelTitle>
          {r.nutrition ? <MacroRing nutrition={r.nutrition} size={150} /> : <p className="text-muted-foreground">Fix the recipe to see nutrition.</p>}
          <p className="mt-4 text-[12px] text-muted-foreground">
            {r.estimated
              ? "Some amounts or foods are estimated, so nutrition is approximate. Estimated amounts are noted beside the ingredients. Check product labels for allergens."
              : <NutritionSource />}{" "}
            Macros means protein, carbs and fat.
          </p>
        </Panel>
      </div>

      <Panel>
        <PanelTitle action={hasTemp(r.steps) && <TemperatureToggle />}>Method</PanelTitle>
        {groupSteps(r.steps, r.step_sections).map((g, n) => (
          <div key={n} className={n > 0 ? "mt-6" : undefined}>
            {g.title && <h3 className="mb-3 text-[16px] font-semibold">{g.title}</h3>}
            <ol className="grid gap-4">
              {g.items.map(({ item: step, index: i }) => (
                <li key={i} className="flex gap-4">
                  <span className="tabular grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary-text">
                    {i + 1}
                  </span>
                  <p className="pt-1">{showTemps(niceFractions(step), unit)}</p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </Panel>

      <StartCooking href={`/recipes/mine/${r.id}/cook`} recipeKey={`mine:${r.id}`}
                    match={{ cookbook_id: r.id }} fullWidth />

      {r.recipe.notes?.trim() && (
        <Panel>
          <details className="group">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-[18px] font-semibold [&::-webkit-details-marker]:hidden">
              Notes
              <ChevronDown className="size-5 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-3 grid gap-3">
              {r.recipe.notes.split("\n").filter((l) => l.trim()).map((line, i) => (
                <li key={i}>{showTemps(niceFractions(line), unit)}</li>
              ))}
            </ul>
          </details>
        </Panel>
      )}
    </div>
  )
}

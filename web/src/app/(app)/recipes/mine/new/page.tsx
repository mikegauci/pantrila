"use client"

import { ArrowLeft, Camera, Link2, PenLine, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useSWRConfig } from "swr"

import { Panel, PanelTitle } from "@/components/bits"
import { BLANK_RECIPE, CookbookForm } from "@/components/cookbook-form"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { send } from "@/lib/api"
import { seconds, usd } from "@/lib/format"
import { useMe } from "@/lib/hooks"
import { toJpegDataUrl } from "@/lib/images"
import { cn } from "@/lib/utils"
import type { CookbookRecipeIn, ImportView } from "@/lib/types"

const MAX_PHOTOS = 4
type Method = "photo" | "link" | "manual"

const METHODS: { key: Method; icon: typeof Camera; title: string; text: string }[] = [
  { key: "photo", icon: Camera, title: "From photos", text: "A cookbook page, a card or a screenshot. Up to 4 photos." },
  { key: "link", icon: Link2, title: "From a link", text: "Paste a recipe page from any site." },
  { key: "manual", icon: PenLine, title: "Type it in", text: "Fill in the form yourself." },
]

function PhotoImport({ onDone }: { onDone: (v: ImportView) => void }) {
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(files: FileList | null) {
    setError(null)
    try {
      const picked = Array.from(files ?? []).slice(0, MAX_PHOTOS - photos.length)
      const urls = await Promise.all(picked.map((f) => toJpegDataUrl(f)))
      setPhotos([...photos, ...urls])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that photo.")
    }
  }

  async function read() {
    setBusy(true)
    setError(null)
    try {
      onDone(await send<ImportView>("/me/recipes/import/photos", "POST", { images: photos }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photos.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-3">
        {photos.map((src, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
            <img src={src} alt={`Photo ${i + 1}`} className="size-28 rounded-2xl border object-cover" />
            <button type="button" aria-label={`Remove photo ${i + 1}`}
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-foreground text-background">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className="grid size-28 cursor-pointer place-items-center rounded-2xl border border-dashed bg-surface-muted text-center text-[12px] text-muted-foreground hover:text-foreground">
            <span><Camera className="mx-auto mb-1 size-5" aria-hidden />Add photo</span>
            <input type="file" accept="image/*" multiple className="sr-only"
                   onChange={(e) => { add(e.target.files); e.target.value = "" }} />
          </label>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Photos are shrunk on your device, read by AI, and not stored.
      </p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <Button size="lg" className="w-fit" disabled={!photos.length || busy} onClick={read}>
        <Sparkles /> {busy ? "Reading the recipe…" : "Read recipe"}
      </Button>
    </div>
  )
}

function LinkImport({ onDone }: { onDone: (v: ImportView) => void }) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          onDone(await send<ImportView>("/me/recipes/import/link", "POST", { url: url.trim() }))
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not import that link.")
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="url" required aria-label="Recipe link" placeholder="https://…" value={url}
               onChange={(e) => setUrl(e.target.value)} className="h-12 flex-1 bg-surface text-[15px]" />
        <Button type="submit" size="lg" className="h-12" disabled={busy}>
          <Sparkles /> {busy ? "Reading the page…" : "Import"}
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Pantrio reads the recipe data the site publishes (or the page text) and keeps the link as the source.
      </p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </form>
  )
}

export default function NewRecipePage() {
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const { data: me, mutate: refreshMe } = useMe()
  const [method, setMethod] = useState<Method | null>(null)
  const [draft, setDraft] = useState<CookbookRecipeIn | null>(null)
  const [result, setResult] = useState<ImportView | null>(null)

  // Cache Components keeps a hidden page's state; start fresh each visit.
  useEffect(() => () => { setMethod(null); setDraft(null); setResult(null) }, [])

  const imported = (v: ImportView) => {
    setResult(v)
    setDraft(v.draft)
    refreshMe()
  }

  return (
    <div className="grid gap-5">
      <Link href="/recipes/mine" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}>
        <ArrowLeft /> My recipes
      </Link>

      {!draft && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {METHODS.map(({ key, icon: Icon, title, text }) => (
              <button
                key={key}
                type="button"
                aria-pressed={method === key}
                onClick={() => (key === "manual" ? setDraft(BLANK_RECIPE) : setMethod(key))}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-[20px] border bg-surface p-5 text-left transition-shadow duration-150 hover:shadow-soft",
                  method === key && "border-primary bg-primary-soft",
                )}
              >
                <span className="grid size-10 place-items-center rounded-full bg-primary-soft">
                  <Icon className="size-5 text-primary-text" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="text-[15px] font-semibold">{title}</span>
                <span className="text-[13px] text-muted-foreground">{text}</span>
              </button>
            ))}
          </div>
          {method && method !== "manual" && (
            <Panel>
              <PanelTitle>{method === "photo" ? "Upload photos" : "Paste a link"}</PanelTitle>
              {method === "photo" ? <PhotoImport onDone={imported} /> : <LinkImport onDone={imported} />}
              {me && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  {me.limits.imports_left} of {me.limits.imports_per_day} AI imports left today.
                </p>
              )}
            </Panel>
          )}
        </>
      )}

      {draft && (
        <>
          {result && (
            <div className="rounded-2xl bg-yellow-soft p-4 text-[13px]">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-[#b7860b]" aria-hidden /> Read by AI. Check it before saving.
                <span className="tabular font-normal text-muted-foreground">
                  {seconds(result.latency_ms)} · {usd(result.cost_usd)}
                </span>
              </p>
              {result.notes.length > 0 && (
                <ul className="mt-2 list-disc pl-5">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              )}
            </div>
          )}
          <CookbookForm
            initial={draft}
            onSaved={(saved) => {
              mutate("/me/recipes")
              router.push(`/recipes/mine/${saved.id}`)
            }}
            onCancel={() => { setDraft(null); setResult(null) }}
          />
        </>
      )}
    </div>
  )
}

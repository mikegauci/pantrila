"use client"

import { ArrowLeft, Camera, ClipboardPaste, Clapperboard, Link2, MessageCircle, PenLine, Share2, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useSWRConfig } from "swr"

import { useAuth } from "@/components/auth-provider"
import { Panel, PanelTitle } from "@/components/bits"
import { BLANK_RECIPE, CHAT_DRAFT, CookbookForm } from "@/components/cookbook-form"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { send } from "@/lib/api"
import { seconds, usd } from "@/lib/format"
import { useMe } from "@/lib/hooks"
import { toJpegDataUrl } from "@/lib/images"
import { cn } from "@/lib/utils"
import { readVideo } from "@/lib/video"
import type { CookbookRecipeIn, ImportView } from "@/lib/types"

const MAX_PHOTOS = 4
type Method = "photo" | "link" | "post" | "manual"

const METHODS: { key: Method; icon: typeof Camera; title: string; text: string }[] = [
  { key: "photo", icon: Camera, title: "From photos", text: "A cookbook page, a card or a screenshot. Up to 4 photos." },
  { key: "link", icon: Link2, title: "From a link", text: "Paste a recipe page from any site." },
  { key: "post", icon: Share2, title: "From a post", text: "A TikTok, Instagram or Facebook post: its caption or the video." },
  { key: "manual", icon: PenLine, title: "Type it in", text: "Fill in the form yourself." },
]

const IMPORT_TITLE: Record<Exclude<Method, "manual">, string> = {
  photo: "Upload photos", link: "Paste a link", post: "Paste a post",
}

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

/** Mirrors `social.detect` on the server: links Pantrio reads as a post's caption. */
const POST_LINK = new RegExp(
  "^(https?://)?(" +
    "(vm|vt)\\.tiktok\\.com/|((www|m)\\.)?tiktok\\.com/(@[\\w.]+/(video|photo)/\\d|t/)" +
    "|((www|m)\\.)?instagram\\.com/([\\w.]+/)?(p|reels?|tv)/" +
    "|((www|m|web)\\.)?(facebook|fb)\\.com/(?!login|checkpoint|$)|fb\\.watch/" +
  ")",
  "i",
)

/** Where people get a video file of a post, per platform (Pantrio never downloads it). */
function videoHelp(link: string): string {
  if (/tiktok\.com/i.test(link)) return "In TikTok: Share, then Save video."
  if (/instagram\.com/i.test(link)) return "Instagram has no save button for others' reels: screen-record it (iPhone: Control Centre, then Screen Recording), then pick the recording."
  if (/(facebook|fb)\.(com|watch)/i.test(link)) return "Facebook: screen-record the video (iPhone: Control Centre, then Screen Recording), then pick the recording."
  return "Save the video (TikTok: Share, then Save video) or screen-record it (Instagram, Facebook), then pick it here."
}

function VideoUpload({ link, caption, disabled, onBusy, onDone }: {
  link: string; caption: string; disabled: boolean; onBusy: (busy: boolean) => void; onDone: (v: ImportView) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<"idle" | "reading" | "sending">("idle")
  const [error, setError] = useState<string | null>(null)

  async function read() {
    if (!file) return
    setError(null)
    onBusy(true)
    try {
      setStep("reading")
      const { audio, frames } = await readVideo(file)
      setStep("sending")
      onDone(await send<ImportView>("/me/recipes/import/video", "POST", {
        audio, frames, url: link || null, caption: caption || null,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that video.")
    } finally {
      setStep("idle")
      onBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-dashed p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Clapperboard className="size-4 text-primary-text" aria-hidden /> Upload the video
      </p>
      <p className="text-[12px] text-muted-foreground">{videoHelp(link)} Up to 3 minutes.</p>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border bg-surface px-3 text-[14px]">
        <span className="truncate">{file ? file.name : "Choose a video…"}</span>
        <input type="file" accept="video/*" aria-label="Video file" className="sr-only"
               onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); e.target.value = "" }} />
      </label>
      <Button type="button" size="lg" className="h-12 w-full sm:w-fit" disabled={!file || step !== "idle" || disabled} onClick={read}>
        <Sparkles /> {step === "reading" ? "Getting the sound…" : step === "sending" ? "Listening to the recipe…" : "Read the video"}
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Your phone keeps the video. Only its sound and 4 still frames are sent, read by AI, and not stored.
      </p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  )
}

function PostImport({ onDone, onScreenshots }: { onDone: (v: ImportView) => void; onScreenshots: () => void }) {
  const [url, setUrl] = useState("")
  const [caption, setCaption] = useState("")
  const [showCaption, setShowCaption] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const videoRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const link = url.trim()
  const text = caption.trim()
  // TikTok doesn't share captions with apps like Pantrio, so its caption box starts open.
  const tiktok = /^(https?:\/\/)?([a-z]+\.)?tiktok\.com\//i.test(link)
  const captionOpen = showCaption || tiktok

  function openVideo() {
    setShowVideo(true)
    requestAnimationFrame(() => videoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  async function read() {
    setBusy(true)
    setError(null)
    try {
      // A caption with no post link is plain pasted text: there is no post to credit.
      onDone(link
        ? await send<ImportView>("/me/recipes/import/post", "POST", { url: link, caption: text || null })
        : await send<ImportView>("/me/recipes/import/text", "POST", { text }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that post.")
      // The link could not be read (or held no recipe): the caption box is the next step.
      if (!text) {
        setShowCaption(true)
        requestAnimationFrame(() => captionRef.current?.focus())
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!busy && !videoBusy) read() }}>
      <div className="grid gap-1.5">
        <Label htmlFor="post-link">Post link</Label>
        <Input id="post-link" type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://www.tiktok.com/@…" value={url}
               onChange={(e) => setUrl(e.target.value)} className="h-12 bg-surface text-[15px]" />
        {link && !POST_LINK.test(link) && (
          <p className="text-[12px] text-muted-foreground">
            {text
              ? "Not a TikTok, Instagram or Facebook post, so Pantrio reads the caption and, if it has no recipe, this page."
              : "Not a TikTok, Instagram or Facebook post, so Pantrio reads it as a recipe page."}
          </p>
        )}
      </div>
      {captionOpen ? (
        <div className="grid gap-1.5">
          <Label htmlFor="post-caption">Caption</Label>
          {tiktok && !text && (
            <p className="text-[12px] text-muted-foreground">
              TikTok doesn&apos;t share captions with other apps. Copy it in TikTok (tap the caption, then hold to copy) and paste it here; the link keeps the credit.
            </p>
          )}
          <Textarea id="post-caption" ref={captionRef} value={caption} rows={6} maxLength={10000}
                    placeholder="Copy the caption from the app (under the post: … then Copy, or hold the text) and paste it here."
                    onChange={(e) => setCaption(e.target.value)} className="min-h-32 bg-surface text-[15px]" />
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setShowCaption(true)}>
          <ClipboardPaste /> Paste the caption
        </Button>
      )}
      <Button type="submit" size="lg" className="h-12 w-full sm:w-fit" disabled={busy || videoBusy || (!link && !text)}>
        <Sparkles /> {busy ? "Reading the post…" : "Read recipe"}
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Pantrio reads the caption (and a recipe site it links to). If the recipe is only in the video,
        upload the video. The post link and creator are kept as the credit.
      </p>
      {error && (
        <div role="alert" className="grid gap-2 text-[13px]">
          <p className="text-danger">{error}</p>
          <div className="flex flex-wrap gap-2">
            {!showVideo && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={openVideo}>
                <Clapperboard /> Upload the video
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onScreenshots}>
              <Camera /> Add screenshots instead
            </Button>
          </div>
        </div>
      )}
      {showVideo ? (
        <div ref={videoRef} className="scroll-mt-24">
          <VideoUpload link={link} caption={text} disabled={busy} onBusy={setVideoBusy} onDone={onDone} />
        </div>
      ) : !error && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={openVideo}>
          <Clapperboard /> Upload the video
        </Button>
      )}
    </form>
  )
}

export default function NewRecipePage() {
  const { session } = useAuth()
  const draftKey = `${CHAT_DRAFT}:${session!.user.id}`
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const { data: me, mutate: refreshMe } = useMe()
  const [method, setMethod] = useState<Method | null>(null)
  const [draft, setDraft] = useState<CookbookRecipeIn | null>(null)
  const [result, setResult] = useState<ImportView | null>(null)
  const [fromChat, setFromChat] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  // Activity re-runs effects when this page becomes visible. Defer consuming the one-shot
  // handoff until the effect survives Strict Mode's setup/cleanup/setup cycle.
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setMethod(null)
      setDraft(null)
      setResult(null)
      setFromChat(false)
      const params = new URLSearchParams(window.location.search)
      if (params.get("from") !== "chat") return
      window.history.replaceState(null, "", "/recipes/mine/new")
      const stored = sessionStorage.getItem(draftKey)
      sessionStorage.removeItem(draftKey)
      if (!stored) return
      let fromAssistant: CookbookRecipeIn
      try {
        fromAssistant = JSON.parse(stored)
      } catch {
        return
      }
      setDraft(fromAssistant)
      setMethod("manual")
      setFromChat(true)
    })
    return () => { active = false }
  }, [draftKey])

  // The section under the picker is often below the fold on a phone: bring it into view.
  useEffect(() => {
    if (method) sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [method])

  const pick = (key: Method) => {
    setResult(null)
    setFromChat(false)
    setDraft(key === "manual" ? BLANK_RECIPE : null)
    setMethod(key)
  }

  const imported = (v: ImportView) => {
    setResult(v)
    setDraft(v.draft)
    refreshMe()
  }

  const showUpload = method !== null && method !== "manual" && !draft

  return (
    <div className="grid gap-5">
      <Link href="/recipes/mine" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}>
        <ArrowLeft /> My recipes
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METHODS.map(({ key, icon: Icon, title, text }) => (
          <button
            key={key}
            type="button"
            aria-pressed={method === key}
            onClick={() => pick(key)}
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

      {(showUpload || draft) && (
        <div ref={sectionRef} className="grid scroll-mt-24 gap-5">
          {showUpload && (
            <Panel>
              <PanelTitle>{IMPORT_TITLE[method as Exclude<Method, "manual">]}</PanelTitle>
              {method === "photo" && <PhotoImport onDone={imported} />}
              {method === "link" && <LinkImport onDone={imported} />}
              {method === "post" && <PostImport onDone={imported} onScreenshots={() => pick("photo")} />}
              {me && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  {me.limits.imports_left} of {me.limits.imports_per_day} AI imports left today.
                </p>
              )}
            </Panel>
          )}

          {draft && (
            <>
              {fromChat && (
                <div className="rounded-2xl bg-yellow-soft p-4 text-[13px]">
                  <p className="flex items-center gap-2 font-semibold">
                    <MessageCircle className="size-4 text-[#b7860b]" aria-hidden /> From the assistant.
                  </p>
                  <p className="mt-1">Check the amounts; foods marked unknown need a pick or an estimate.</p>
                </div>
              )}
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
                onCancel={() => { setMethod(null); setDraft(null); setResult(null); setFromChat(false) }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

import { router, useLocalSearchParams } from "expo-router"
import { Camera, ChevronDown, ClipboardPaste, Images, Link2, PenLine, Share2, Sparkles, X } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useSWRConfig } from "swr"

import { BLANK_RECIPE, needsReview, POST_LINK, postPlatform } from "@pantrila/core/cookbook"
import { seconds, usd } from "@pantrila/core/format"
import { leftText } from "@pantrila/core/subscription"
import type { CookbookRecipeIn, ImportView } from "@pantrila/core/types"

import { useAuth } from "@/components/auth-provider"
import { Button, Panel, PanelTitle } from "@/components/bits"
import { CookbookForm } from "@/components/cookbook-form"
import { Icon } from "@/components/icon"
import { ImportProgress } from "@/components/import-progress"
import { ApiError } from "@/lib/api"
import { useApi, useMe, useMeta } from "@/lib/hooks"
import { PhotoAccessError, pickPhotos } from "@/lib/images"
import {
  forgetImport, type ImportRequest, type ImportStep, importRecipe, pendingImport, wasStartedHere, watchImport,
} from "@/lib/import-jobs"
import { saveNewRecipe } from "@/lib/photo-jobs"
import { toast } from "@/lib/toast"

const MAX_PHOTOS = 4
type Method = "photo" | "link" | "post" | "text" | "manual"

const METHODS: { key: Method; icon: typeof Camera; title: string; text: string }[] = [
  { key: "post", icon: Share2, title: "From social media", text: "A TikTok, Instagram or Facebook post: its caption or the video." },
  { key: "link", icon: Link2, title: "From a link", text: "Paste a recipe page from any site." },
  { key: "photo", icon: Camera, title: "From photos", text: "A cookbook page, a card or a screenshot. Up to 4 photos." },
  { key: "text", icon: ClipboardPaste, title: "Paste text", text: "A recipe copied from a note, a message or an email." },
  { key: "manual", icon: PenLine, title: "Type it in", text: "Fill in the form yourself." },
]

const IMPORT_TITLE: Record<Exclude<Method, "manual">, string> = {
  photo: "Add photos", link: "Paste a link", post: "Paste a social media post, reel or video", text: "Paste the recipe",
}

const INPUT = "h-12 rounded-xl border border-border bg-surface px-3 font-sans text-[15px] text-foreground"

/** Runs one import as a background job and hands its draft on; shows the steps meanwhile. */
function useImport(onDone: (v: ImportView) => void) {
  const userId = useAuth().session!.user.id
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<ImportStep[]>([])
  const [error, setError] = useState<string | null>(null)
  async function run(request: ImportRequest, fallback: string) {
    setBusy(true)
    setSteps([])
    setError(null)
    try {
      onDone(await importRecipe(userId, request, setSteps))
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    } finally {
      setBusy(false)
    }
  }
  return { busy, steps, error, setError, run }
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <Text accessibilityRole="alert" className="font-sans text-[13px] text-danger">{error}</Text> : null
}

function PhotoImport({ onDone }: { onDone: (v: ImportView) => void }) {
  const [photos, setPhotos] = useState<string[]>([])
  const [denied, setDenied] = useState(false)
  const job = useImport(onDone)

  async function add(from: "camera" | "library") {
    job.setError(null)
    setDenied(false)
    try {
      const picked = await pickPhotos(from, MAX_PHOTOS - photos.length)
      setPhotos([...photos, ...picked].slice(0, MAX_PHOTOS))
    } catch (e) {
      if (e instanceof PhotoAccessError) setDenied(true)
      job.setError(e instanceof Error ? e.message : "Could not read that photo.")
    }
  }

  return (
    <View className="gap-4">
      {photos.length > 0 && (
        <View className="flex-row flex-wrap gap-3">
          {photos.map((src, i) => (
            <View key={i}>
              <Image source={{ uri: src }} accessibilityLabel={`Photo ${i + 1}`}
                     className="size-24 rounded-2xl border border-border" />
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} hitSlop={6}
                         onPress={() => setPhotos(photos.filter((_, j) => j !== i))}
                         className="absolute -top-2 -right-2 size-6 items-center justify-center rounded-full bg-foreground">
                <Icon icon={X} tone="background" size={14} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {photos.length < MAX_PHOTOS && !job.busy && (
        <View className="flex-row gap-2">
          <Button variant="outline" icon={Camera} text="Take a photo" className="flex-1" onPress={() => add("camera")} />
          <Button variant="outline" icon={Images} text="Choose photos" className="flex-1" onPress={() => add("library")} />
        </View>
      )}
      <Text className="font-sans text-xs text-muted-foreground">Photos are shrunk on your phone, read by AI, and not stored.</Text>
      <ErrorText error={job.error} />
      {denied && <Button variant="ghost" size="sm" text="Open Settings" onPress={() => Linking.openSettings()} />}
      <Button icon={Sparkles} disabled={!photos.length} busy={job.busy}
              text={job.busy ? "Reading the recipe…" : "Read recipe"}
              onPress={() => job.run({ kind: "photos", images: photos }, "Could not read the photos.")} />
      {job.busy && <ImportProgress steps={job.steps} />}
    </View>
  )
}

function LinkImport({ kind, onDone }: { kind: "link" | "post"; onDone: (v: ImportView) => void }) {
  const [url, setUrl] = useState("")
  const [estimate, setEstimate] = useState<number | null>(null)
  const job = useImport(onDone)
  const link = url.trim()
  const { data: meta } = useMeta()
  const { data: timing } = useApi<{ estimated_seconds: number }>("/me/recipes/import/timing")
  // Posts whose video Pantrila can hear take a minute or two: show a rough countdown for those.
  const slow = kind === "post" ? (meta?.reel_platforms ?? []).includes(postPlatform(link) ?? "") : POST_LINK.test(link)

  function read() {
    if (!link || job.busy) return
    setEstimate(slow ? timing?.estimated_seconds ?? 105 : null)
    job.run({ kind, url: link }, kind === "post" ? "Could not read that post." : "Could not import that link.")
  }

  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <Text className="font-sans-medium text-sm text-foreground">{kind === "post" ? "Post link" : "Recipe link"}</Text>
        <TextInput accessibilityLabel={kind === "post" ? "Post link" : "Recipe link"} value={url} onChangeText={setUrl}
                   placeholder={kind === "post" ? "Paste Instagram, Facebook or TikTok link" : "https://…"}
                   placeholderTextColorClassName="accent-muted-foreground" keyboardType="url" autoCapitalize="none"
                   autoCorrect={false} returnKeyType="go" onSubmitEditing={read} editable={!job.busy} className={INPUT} />
        {kind === "post" && link !== "" && !POST_LINK.test(link) && (
          <Text className="font-sans text-xs text-muted-foreground">Pantrila will read this link as a recipe page.</Text>
        )}
      </View>
      <Button icon={Sparkles} disabled={!link} busy={job.busy} onPress={read}
              text={job.busy ? (kind === "post" ? "Reading the post…" : "Reading the page…") : "Read recipe"} />
      {job.busy && <ImportProgress steps={job.steps} estimatedSeconds={estimate} />}
      <Text className="font-sans text-xs text-muted-foreground">
        {kind === "post"
          ? "Pantrila reads the recipe from your post and credits the creator."
          : "Pantrila reads the recipe data the site publishes (or the page text) and keeps the link as the source."}
      </Text>
      <ErrorText error={job.error} />
    </View>
  )
}

function TextImport({ onDone }: { onDone: (v: ImportView) => void }) {
  const [text, setText] = useState("")
  const job = useImport(onDone)
  return (
    <View className="gap-3">
      <TextInput accessibilityLabel="Recipe text" value={text} onChangeText={setText} multiline maxLength={20000}
                 placeholder="Paste the ingredients and method" placeholderTextColorClassName="accent-muted-foreground"
                 textAlignVertical="top" editable={!job.busy}
                 className="min-h-40 rounded-xl border border-border bg-surface px-3 py-2.5 font-sans text-base text-foreground" />
      <Button icon={Sparkles} disabled={!text.trim()} busy={job.busy} text={job.busy ? "Reading the recipe…" : "Read recipe"}
              onPress={() => job.run({ kind: "text", text: text.trim() }, "Could not read that text.")} />
      {job.busy && <ImportProgress steps={job.steps} />}
      <ErrorText error={job.error} />
    </View>
  )
}

/** Add a recipe: from a post, a link, photos or pasted text (read by AI as a background job,
 * then saved straight away unless something needs the person), or typed into the form.
 * `?method=post|link` (from Home) opens that way at once. An import still running when the app
 * was closed is picked up again here ("Finishing your import…"). */
export default function NewRecipe() {
  const userId = useAuth().session!.user.id
  const params = useLocalSearchParams<{ method?: string }>()
  const { mutate } = useSWRConfig()
  const { data: me, mutate: refreshMe } = useMe()
  const [method, setMethod] = useState<Method | null>(() => METHODS.find((m) => m.key === params.method)?.key ?? null)
  const [draft, setDraft] = useState<CookbookRecipeIn | null>(method === "manual" ? BLANK_RECIPE : null)
  // A new draft gets a fresh form: the form keeps its own copy.
  const [formKey, setFormKey] = useState(0)
  const [result, setResult] = useState<ImportView | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [resumeSteps, setResumeSteps] = useState<ImportStep[]>([])
  const stopWaiting = useRef<(() => void) | null>(null)

  const review = (v: ImportView) => {
    setResult(v)
    setDraft(v.draft)
    setFormKey((k) => k + 1)
  }

  // An import goes straight to My recipes. Only a draft that cannot be saved as it is (a food
  // left unknown, no method, or one the API refuses) opens the form to finish it.
  async function imported(v: ImportView) {
    setResumeError(null)
    refreshMe()
    if (needsReview(v.draft)) return review(v)
    setSaving(true)
    try {
      const saved = await saveNewRecipe(v.draft, mutate, me?.limits.photos.left !== 0)
      toast.success(`Saved ${saved.title}`)
      router.replace({ pathname: "/recipes/mine/[id]", params: { id: String(saved.id) } })
    } catch (e) {
      toast.error(e instanceof ApiError && e.problems.length ? e.problems.join("; ")
                  : e instanceof Error ? e.message : "Could not save.")
      review(v)
    } finally {
      setSaving(false)
    }
  }

  // An import keeps running on the server when the app is closed: pick it up again. A screen
  // still waiting on the same job delivers its result itself.
  useEffect(() => {
    let active = true
    pendingImport(userId).then((id) => {
      if (!id || !active || wasStartedHere(id)) return
      stopWaiting.current = () => {
        active = false
        forgetImport(userId, id)
        setResuming(false)
      }
      setResuming(true)
      watchImport(userId, id, Date.now(), (steps) => { if (active) setResumeSteps(steps) })
        .then((v) => { if (active) imported(v) })
        .catch((e) => { if (active) setResumeError(e instanceof Error ? e.message : "The import failed.") })
        .finally(() => { if (active) setResuming(false) })
    })
    return () => { active = false; stopWaiting.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per user
  }, [userId])

  function pick(key: Method) {
    setResumeError(null)
    setResult(null)
    setDraft(key === "manual" ? BLANK_RECIPE : null)
    setFormKey((k) => k + 1)
    setMethod(key)
  }

  const showImport = method !== null && method !== "manual" && !draft && !saving

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}
                          keyboardVerticalOffset={100}>
      <ScrollView contentContainerClassName="gap-5 px-4 pt-2 pb-12" keyboardShouldPersistTaps="handled">
        {!draft && (
          <View className="gap-2">
            {METHODS.map(({ key, icon, title, text }) => (
              <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: method === key }}
                         accessibilityLabel={title} onPress={() => pick(key)}
                         className={`flex-row items-center gap-3 rounded-[20px] border p-4 ${method === key ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}>
                <View className="size-10 items-center justify-center rounded-full bg-primary-soft">
                  <Icon icon={icon} tone="primary-text" size={20} strokeWidth={1.75} />
                </View>
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[15px] text-foreground">{title}</Text>
                  <Text className="font-sans text-[13px] text-muted-foreground">{text}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {resuming && !draft && (
          <Panel className="gap-2">
            <Text className="font-sans-semibold text-[13px] text-foreground">Finishing your import…</Text>
            <Text className="font-sans text-[13px] text-muted-foreground">
              It kept running while you were away. The recipe will appear here when it is read.
            </Text>
            <ImportProgress steps={resumeSteps} />
            <Button variant="ghost" size="sm" text="Stop waiting" className="self-start" onPress={() => stopWaiting.current?.()} />
          </Panel>
        )}
        {saving && (
          <Panel><Text accessibilityRole="alert" className="font-sans-semibold text-[13px] text-foreground">Saving to your recipes…</Text></Panel>
        )}
        {resumeError && !draft && <ErrorText error={resumeError} />}

        {showImport && (
          <Panel>
            <PanelTitle>{IMPORT_TITLE[method as Exclude<Method, "manual">]}</PanelTitle>
            {method === "photo" && <PhotoImport onDone={imported} />}
            {method === "link" && <LinkImport kind="link" onDone={imported} />}
            {method === "post" && <LinkImport kind="post" onDone={imported} />}
            {method === "text" && <TextImport onDone={imported} />}
            {me && <Text className="mt-3 font-sans text-xs text-muted-foreground">{leftText("import", me.limits.imports)}.</Text>}
          </Panel>
        )}

        {draft && (
          <>
            {result && (
              <View className="rounded-2xl bg-yellow-soft p-4">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Sparkles size={16} color="#b7860b" />
                  <Text className="font-sans-semibold text-[13px] text-foreground">Read by AI. Finish it before saving.</Text>
                  <Text className="font-sans text-[13px] text-muted-foreground">
                    {seconds(result.latency_ms)} · {usd(result.cost_usd)}
                  </Text>
                </View>
                {result.notes.length > 0 && (
                  <>
                    <Pressable accessibilityRole="button" accessibilityState={{ expanded: notesOpen }}
                               onPress={() => setNotesOpen(!notesOpen)} className="mt-1 min-h-9 flex-row items-center gap-1.5">
                      <View style={{ transform: [{ rotate: notesOpen ? "180deg" : "0deg" }] }}>
                        <Icon icon={ChevronDown} size={16} />
                      </View>
                      <Text className="font-sans-medium text-[13px] text-foreground">
                        {result.notes.length} {result.notes.length === 1 ? "note" : "notes"} to check
                      </Text>
                    </Pressable>
                    {notesOpen && result.notes.map((n) => (
                      <Text key={n} className="mt-1 font-sans text-[13px] text-foreground">• {n}</Text>
                    ))}
                  </>
                )}
              </View>
            )}
            <CookbookForm
              key={formKey}
              initial={draft}
              onSaved={(saved) => router.replace({ pathname: "/recipes/mine/[id]", params: { id: String(saved.id) } })}
              onCancel={() => { setMethod(null); setDraft(null); setResult(null) }}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

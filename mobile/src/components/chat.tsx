import { router } from "expo-router"
import {
  BookmarkPlus, Check, PenLine, Refrigerator, Repeat, Scale, Search, Sparkles, Trash2, type LucideIcon,
} from "lucide-react-native"
import { Fragment } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"

import { chatBlocks, draftTag, headingOf, inlineParts, type ToolIcon, toolSummary, usedRecipes } from "@pantrila/core/chat"
import { ago } from "@pantrila/core/format"
import type { ChatMessage, ChatThreadSummary, CookbookRecipeIn, RecipeCard } from "@pantrila/core/types"

import { Button, ProblemAlert, RecipeArt } from "@/components/bits"
import { Icon } from "@/components/icon"
import { holdChatDraft } from "@/lib/chat-draft"
import { useCookbook, useRecipe } from "@/lib/hooks"

/** The assistant's messages on the phone, read like the web's (`@pantrila/core/chat`). */

/** A saved message, or one only this screen knows about: the question in flight or an error. */
export interface Message extends ChatMessage {
  error?: boolean
}

const TOOL_ICON: Record<ToolIcon, LucideIcon> = {
  search: Search, pantry: Refrigerator, swap: Repeat, scale: Scale, write: PenLine, other: Sparkles,
}

const openRecipe = (id: string) => router.push({ pathname: "/recipes/[id]", params: { id } })

/** A line's text: **bold** and [recipe-id] citations, each citation a link titled as its recipe. */
function Inline({ text, recipes }: { text: string; recipes: Map<string, RecipeCard> }) {
  return inlineParts(text, recipes).map((part, i) => {
    if (part.kind === "cite") {
      const r = part.recipe
      return r ? (
        <Fragment key={i}>
          <Text accessibilityRole="link" onPress={() => openRecipe(r.id)}
                className={`font-sans-medium underline ${r.problems.length ? "text-danger" : "text-primary-text"}`}>
            {r.title}
          </Text>
          <Text className="text-muted-foreground"> · {Math.round(r.nutrition.kcal)} kcal</Text>
        </Fragment>
      ) : <Text key={i} className="text-muted-foreground">{part.text}</Text>
    }
    if (part.kind === "bold") return <Text key={i} className="font-sans-semibold">{part.text}</Text>
    return part.text
  })
}

const TEXT = "font-sans text-[15px] leading-[22px] text-foreground"

/** Paragraphs and bulleted lists, with headings as bold lines. */
export function Rich({ text, recipes, className = "" }: { text: string; recipes: Map<string, RecipeCard>; className?: string }) {
  return (
    <View className="gap-2.5">
      {chatBlocks(text, recipes).map((b, bi) => b.list ? (
        <View key={bi} className="gap-1.5">
          {b.lines.map((l, li) => (
            <View key={li} className="flex-row gap-2 pl-1">
              <Text className={`${TEXT} text-muted-foreground`}>•</Text>
              <Text className={`${TEXT} flex-1 ${className}`}><Inline text={l} recipes={recipes} /></Text>
            </View>
          ))}
        </View>
      ) : (
        <Text key={bi} className={`${TEXT} ${className}`}>
          {b.lines.map((l, li) => {
            const heading = headingOf(l)
            return (
              <Fragment key={li}>
                {li > 0 && "\n"}
                {heading ? <Text className="font-sans-semibold">{heading}</Text> : <Inline text={l} recipes={recipes} />}
              </Fragment>
            )
          })}
        </Text>
      ))}
    </View>
  )
}

/** A recipe the reply uses: photo, title, time and kcal, and cook mode at the servings the reply gave. */
function RecipeCardView({ id, servings }: { id: string; servings?: number }) {
  const { data: recipe } = useRecipe(id)
  if (!recipe) return null
  return (
    <View className="w-44 gap-2 rounded-2xl border border-border bg-surface p-2">
      <Pressable accessibilityRole="link" accessibilityLabel={recipe.title} onPress={() => openRecipe(id)} className="gap-2">
        <RecipeArt meal={recipe.meal_types[0]} cuisine={recipe.cuisine || undefined} photo={recipe.photo_url}
                   className="aspect-[4/3] w-full" />
        <Text numberOfLines={2} className="px-1 font-sans-semibold text-[13px] leading-5 text-foreground">{recipe.title}</Text>
      </Pressable>
      <Text className="px-1 font-sans text-xs text-muted-foreground">
        {recipe.total_minutes} min · {Math.round(recipe.nutrition.kcal)} kcal
      </Text>
      {recipe.problems.length > 0 && <Text className="px-1 font-sans-medium text-xs text-danger">Not for you</Text>}
      <Button variant="outline" size="sm" text="Let's cook this!" className="mt-auto"
              onPress={() => router.push({
                pathname: "/recipes/[id]/cook", params: { id, servings: String(servings ?? recipe.servings) },
              })} />
    </View>
  )
}

/** The question asked, or the assistant's reply: its profile check, what the tools did, the text,
 * the recipes it uses and each recipe it wrote, ready to save to My recipes. */
export function Bubble({ m, thread }: { m: Message; thread: number | null }) {
  const { data: cookbook } = useCookbook()
  if (m.role === "user") {
    return (
      <View className="max-w-[85%] self-end rounded-[20px] rounded-br-md bg-primary px-4 py-2.5">
        <Text className="font-sans text-[15px] leading-[22px] text-primary-foreground">{m.text}</Text>
      </View>
    )
  }
  const r = m.reply
  const recipes = new Map(r?.cited.map((c) => [c.id, c]))
  const used = usedRecipes(r)
  const save = (d: CookbookRecipeIn) => {
    const draft = holdChatDraft({ ...d, chat_draft: draftTag(thread, d) })
    router.push({
      pathname: "/recipes/mine/new",
      params: { from: "chat", draft: String(draft), ...(thread ? { thread: String(thread) } : {}) },
    })
  }
  return (
    <View className="max-w-[92%] gap-2">
      <ProblemAlert title="Current profile check" items={r?.profile_problems ?? []} />
      {r?.tool_calls.map((c, i) => {
        const { icon, text } = toolSummary(c)
        return (
          <View key={i} className="flex-row items-start gap-2 rounded-xl border border-dashed border-border bg-surface-muted px-3 py-2">
            <Icon icon={TOOL_ICON[icon]} tone="muted-foreground" size={14} />
            <Text className="flex-1 font-sans text-xs text-muted-foreground">{text}</Text>
          </View>
        )
      })}
      <View className={`rounded-[20px] rounded-bl-md border bg-surface px-4 py-3 ${m.error ? "border-danger/50" : "border-border"}`}>
        <Rich text={m.text} recipes={recipes} className={m.error ? "text-danger" : ""} />
        {!m.error && used.size > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-2 mt-3 border-t border-border pt-3"
                      contentContainerClassName="gap-3 px-2">
            {[...used].map(([id, servings]) => <RecipeCardView key={id} id={id} servings={servings} />)}
          </ScrollView>
        )}
      </View>
      {r?.drafts?.map((d, i) => {
        const tag = draftTag(thread, d)
        const saved = tag ? cookbook?.find((c) => c.chat_draft === tag) : undefined
        return (
          <View key={i} className="gap-2">
            <ProblemAlert title={`Check ${d.title}`} items={r.draft_problems?.[i] ?? []} />
            {saved ? (
              <Button variant="outline" size="sm" icon={Check} className="self-start"
                      text={`Saved to My recipes as “${saved.title}”`}
                      onPress={() => router.push({ pathname: "/recipes/mine/[id]", params: { id: String(saved.id) } })} />
            ) : (
              <Button variant="outline" size="sm" icon={BookmarkPlus} className="self-start"
                      text={`Save “${d.title}” to My recipes`} onPress={() => save(d)} />
            )}
          </View>
        )
      })}
      {r && r.flagged.length > 0 && (
        <Text className="font-sans text-[11px] text-muted-foreground">safety note added by code</Text>
      )}
    </View>
  )
}

/** The person's saved chats, most recently used first. */
export function ChatThreads({ threads, current, disabled, onSelect, onDelete }: {
  threads: ChatThreadSummary[] | undefined
  current: number | null
  disabled?: boolean
  onSelect: (id: number) => void
  onDelete: (thread: ChatThreadSummary) => void
}) {
  if (!threads?.length) {
    return <Text className="px-1 py-2 font-sans text-[13px] text-muted-foreground">Your chats appear here.</Text>
  }
  return (
    <View className="gap-1">
      {threads.map((t) => {
        const active = t.id === current
        return (
          <View key={t.id} className={`flex-row items-center rounded-xl ${active ? "bg-primary-soft" : ""}`}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled}
                       onPress={() => onSelect(t.id)} className="flex-1 px-3 py-2.5">
              <Text numberOfLines={1} className={`font-sans-medium text-[15px] ${active ? "text-primary-text" : "text-foreground"}`}>
                {t.title}
              </Text>
              <Text className="font-sans text-xs text-muted-foreground">{ago(t.updated_at)}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete “${t.title}”`} disabled={disabled}
                       onPress={() => onDelete(t)} hitSlop={6} className="mr-1 size-10 items-center justify-center">
              <Icon icon={Trash2} tone="muted-foreground" size={18} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

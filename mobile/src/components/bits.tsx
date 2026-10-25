import { Image } from "expo-image"
import {
  Apple, CakeSlice, CookingPot, EggFried, Minus, Plus, Salad, Sparkles, TriangleAlert, type LucideIcon,
} from "lucide-react-native"
import { Pressable, Text, View } from "react-native"

import { label } from "@pantrila/core/format"
import type { Allergen, DietTag, MealType } from "@pantrila/core/types"

import { Icon } from "@/components/icon"

/** The phone versions of web/src/components/bits.tsx: same names, tokens and wording. */

export function Panel({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <View className={`rounded-3xl border border-border bg-surface p-5 ${className}`}>{children}</View>
}

export function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View className="mb-3 flex-row items-center justify-between gap-3">
      <Text accessibilityRole="header" className="flex-1 font-sans-semibold text-lg text-foreground">{children}</Text>
      {action}
    </View>
  )
}

export function DietBadge({ diet }: { diet: DietTag }) {
  return (
    <View className="h-6 justify-center rounded-full bg-primary-soft px-2.5">
      <Text className="font-sans-medium text-xs text-primary-text">{label(diet)}</Text>
    </View>
  )
}

export function AllergenBadge({ allergen, danger = false }: { allergen: Allergen; danger?: boolean }) {
  return (
    <View className={`h-6 flex-row items-center gap-1 rounded-full px-2.5 ${danger ? "bg-danger" : "bg-surface-muted"}`}>
      {danger && <TriangleAlert size={12} color="white" />}
      <Text className={`font-sans-medium text-xs ${danger ? "text-white" : "text-muted-foreground"}`}>
        {label(allergen)}
      </Text>
    </View>
  )
}

export function AiBadge({ children = "AI-generated" }: { children?: string }) {
  return (
    <View className="h-6 flex-row items-center gap-1 rounded-full bg-yellow-soft px-2.5">
      <Sparkles size={12} color="#b7860b" />
      <Text className="font-sans-medium text-xs text-foreground">{children}</Text>
    </View>
  )
}

/** Loud, never hidden: a hard rule this recipe or plan breaks for the person. */
export function ProblemAlert({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <View accessibilityRole="alert" className="flex-row gap-3 rounded-2xl border border-danger/40 bg-danger-soft p-4">
      <Icon icon={TriangleAlert} tone="danger" size={20} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-base text-danger">{title}</Text>
        {items.map((i) => (
          <Text key={i} className="mt-1 font-sans text-sm text-foreground">• {i}</Text>
        ))}
      </View>
    </View>
  )
}

const MEAL_ART: Record<MealType, { icon: LucideIcon; bg: string; fg: string }> = {
  breakfast: { icon: EggFried, bg: "bg-yellow-soft", fg: "#b7860b" },
  lunch: { icon: Salad, bg: "bg-primary-soft", fg: "#2e8a3b" },
  dinner: { icon: CookingPot, bg: "bg-orange-soft", fg: "#c06a05" },
  snack: { icon: Apple, bg: "bg-[#e3f4ee]", fg: "#2f8f72" },
  dessert: { icon: CakeSlice, bg: "bg-[#fbe7ef]", fg: "#b8456f" },
}

/** The recipe's 4:3 photo when it has one, else meal-type art on a tint. */
export function RecipeArt({ meal, cuisine, photo, size = "md", className = "" }: {
  meal: MealType
  cuisine?: string
  photo?: string | null
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const art = MEAL_ART[meal] ?? MEAL_ART.dinner
  const Glyph = art.icon
  return (
    <View className={`items-center justify-center overflow-hidden rounded-2xl ${art.bg} ${className}`}>
      {photo ? (
        <Image source={photo} contentFit="cover" transition={150} accessibilityIgnoresInvertColors
               style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
      ) : (
        <Glyph color={art.fg} strokeWidth={1.5} size={size === "sm" ? 24 : size === "lg" ? 64 : 44} />
      )}
      {cuisine && size !== "sm" && (
        <View className="absolute bottom-2 left-2 rounded-full bg-surface/90 px-2 py-0.5">
          <Text className="font-sans-medium text-[11px] text-foreground">{label(cuisine)}</Text>
        </View>
      )}
    </View>
  )
}

export function EmptyState({ icon, title, children, action }: {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <View className="items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10">
      <View className="size-12 items-center justify-center rounded-full bg-primary-soft">
        <Icon icon={icon} tone="primary-text" size={24} />
      </View>
      <Text className="text-center font-sans-semibold text-lg text-foreground">{title}</Text>
      {children && <Text className="text-center font-sans text-base text-muted-foreground">{children}</Text>}
      {action}
    </View>
  )
}

/** An error from the API in the screen's place, with a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" className="gap-3 rounded-2xl border border-danger/40 bg-danger-soft p-4">
      <Text className="font-sans text-base text-danger">{message}</Text>
      {onRetry && (
        <Text accessibilityRole="button" onPress={onRetry} className="font-sans-semibold text-base text-primary-text">
          Try again
        </Text>
      )}
    </View>
  )
}

export function Stat({ label: name, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View className="min-w-[40%] flex-1">
      <Text className="font-sans-medium text-xs text-muted-foreground">{name}</Text>
      <Text className="font-sans-bold text-[26px] leading-9 text-foreground">{value}</Text>
      {hint && <Text className="font-sans text-xs text-muted-foreground">{hint}</Text>}
    </View>
  )
}

/** − n things + : servings on a recipe, people on the grocery list. */
export function Stepper({ name, value, text, min, max, onChange }: {
  name: string; value: number; text: string; min: number; max: number; onChange: (n: number) => void
}) {
  const step = (icon: LucideIcon, label: string, to: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onChange(to)} hitSlop={6}
               className="size-8 items-center justify-center rounded-lg border border-border bg-surface">
      <Icon icon={icon} size={16} />
    </Pressable>
  )
  return (
    <View accessibilityLabel={name} className="flex-row items-center gap-1">
      {step(Minus, `Fewer ${name.toLowerCase()}`, Math.max(min, value - 1))}
      <Text className="w-[88px] text-center font-sans-semibold text-[13px] text-foreground">{text}</Text>
      {step(Plus, `More ${name.toLowerCase()}`, Math.min(max, value + 1))}
    </View>
  )
}

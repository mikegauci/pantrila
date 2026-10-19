import {
  Apple, CakeSlice, CookingPot, EggFried, Salad, Sparkles, TriangleAlert,
} from "lucide-react"
import Image from "next/image"

import { cn } from "@/lib/utils"
import { label } from "@/lib/format"
import type { Allergen, DietTag, MealType } from "@/lib/types"

/** A card per the design system: white, 20px radius, 1px border. */
export function Panel({
  className, children, ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-[20px] border bg-surface p-5 xl:p-6", className)}
      {...props}
    >
      {children}
    </section>
  )
}

export function PanelTitle({
  children, action, className,
}: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[18px] font-semibold leading-[26px]">{children}</h2>
      {action}
    </div>
  )
}

export function DietBadge({ diet }: { diet: DietTag }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-primary-soft px-2.5 text-[12px] font-medium text-primary-text">
      {label(diet)}
    </span>
  )
}

export function AllergenBadge({ allergen, danger = false }: { allergen: Allergen; danger?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium",
        danger ? "bg-danger text-white" : "bg-surface-muted text-muted-foreground",
      )}
    >
      {danger && <TriangleAlert className="size-3" aria-hidden />}
      {label(allergen)}
    </span>
  )
}

export function AiBadge({ children = "AI-generated" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-yellow-soft px-2.5 text-[12px] font-medium text-foreground">
      <Sparkles className="size-3 text-[#b7860b]" aria-hidden /> {children}
    </span>
  )
}

/** Loud, never hidden: a hard rule this recipe or plan breaks for the person. */
export function ProblemAlert({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div role="alert" className="flex gap-3 rounded-2xl border border-danger/40 bg-danger-soft p-4 text-foreground">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div>
        <p className="font-semibold text-danger">{title}</p>
        <ul className="mt-1 list-disc pl-4 text-[13px]">
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </div>
    </div>
  )
}

const MEAL_ART: Record<MealType, { icon: typeof Salad; bg: string; fg: string }> = {
  breakfast: { icon: EggFried, bg: "bg-yellow-soft", fg: "text-[#b7860b]" },
  lunch: { icon: Salad, bg: "bg-primary-soft", fg: "text-primary-text" },
  dinner: { icon: CookingPot, bg: "bg-orange-soft", fg: "text-[#c06a05]" },
  snack: { icon: Apple, bg: "bg-[#e3f4ee]", fg: "text-[#2f8f72]" },
  dessert: { icon: CakeSlice, bg: "bg-[#fbe7ef]", fg: "text-[#b8456f]" },
}

/** Recipes have no photos, so a meal-coloured tile with an icon stands in. */
/** The recipe's 4:3 photo when it has one (served resized by next/image; `sizes` says how
 * wide it shows), else meal-type art on a tint. */
export function RecipeArt({
  meal, cuisine, className, size = "md", photo, sizes = "(min-width: 768px) 33vw, 100vw",
}: {
  meal: MealType
  cuisine?: string
  className?: string
  size?: "sm" | "md" | "lg"
  photo?: string | null
  sizes?: string
}) {
  const art = MEAL_ART[meal] ?? MEAL_ART.dinner
  const Icon = art.icon
  return (
    <div className={cn("relative grid place-items-center overflow-hidden rounded-2xl", art.bg, className)}>
      {photo ? (
        <Image src={photo} alt="" fill sizes={sizes} className="object-cover" />
      ) : (
        <Icon
          className={cn(art.fg, size === "sm" ? "size-6" : size === "lg" ? "size-16" : "size-11")}
          strokeWidth={1.5}
          aria-hidden
        />
      )}
      {cuisine && size !== "sm" && (
        <span className="absolute bottom-2 left-2 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium">
          {label(cuisine)}
        </span>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon, title, children, action,
}: {
  icon: typeof Salad
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="mb-4 grid size-20 place-items-center rounded-full bg-primary-soft">
        <Icon className="size-9 text-primary-text" strokeWidth={1.5} aria-hidden />
      </div>
      <p className="text-[18px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-md text-muted-foreground">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Stat({
  label: name, value, hint, tone = "default",
}: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "good" | "warn" }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground">{name}</p>
      <p className="tabular text-[28px] font-bold leading-[36px] md:text-[32px] md:leading-[38px]">{value}</p>
      {hint && (
        <p
          className={cn(
            "mt-1 inline-flex rounded-full text-[12px] font-medium",
            tone === "good" && "bg-primary-soft px-2 text-primary-text",
            tone === "warn" && "bg-orange-soft px-2 text-[#a65a00]",
            tone === "default" && "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

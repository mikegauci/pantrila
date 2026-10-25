import type { LucideIcon } from "lucide-react-native"
import { useCSSVariable } from "uniwind"

/** A Lucide icon (the web's icon set) in one of the theme's colours, so it follows dark mode. */
export function Icon({ icon: Glyph, tone = "foreground", size = 18, strokeWidth = 2 }: {
  icon: LucideIcon
  tone?: string
  size?: number
  strokeWidth?: number
}) {
  const color = useCSSVariable(`--color-${tone}`)
  return <Glyph size={size} strokeWidth={strokeWidth} color={typeof color === "string" ? color : undefined} />
}

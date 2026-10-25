import { Camera, Clapperboard, ClipboardPaste, Link2, PenLine, Share2, type LucideIcon } from "lucide-react-native"

import type { RecipeSource } from "@pantrila/core/types"

/** The icon beside "From a photo", "From a link"… (core's `SOURCE_TEXT`), as on the web. */
export const SOURCE_ICON: Record<RecipeSource, LucideIcon> = {
  photo: Camera, link: Link2, post: Share2, text: ClipboardPaste, video: Clapperboard, manual: PenLine,
}

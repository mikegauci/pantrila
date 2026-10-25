/** A stable, random-looking avatar per user: food emoji on a soft tint, picked from the user id. */

const EMOJI = ["🥑", "🍋", "🍅", "🥕", "🥦", "🍓", "🫐", "🥐", "🧀", "🌶️", "🍄", "🥨", "🍑", "🥥", "🫑", "🍇"]

// Soft tints from globals.css; each has a dark-mode value there.
const BG = [
  "bg-primary-soft",
  "bg-yellow-soft",
  "bg-orange-soft",
  "bg-danger-soft",
  "bg-fibre/25",
  "bg-surface-muted",
]

/** 32-bit FNV-1a. */
function fnv1a(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function avatarFor(id: string) {
  const hash = fnv1a(id)
  return { emoji: EMOJI[hash % EMOJI.length], bg: BG[Math.floor(hash / EMOJI.length) % BG.length] }
}

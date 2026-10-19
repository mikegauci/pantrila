/** Shrink a photo in the browser before upload: JPEG, longest side `max` px. Keeps requests
 * small and readable for the model; the original never leaves the device. */
export async function toJpegDataUrl(file: File, max = 1600, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error(`${file.name} is not a photo this browser can read. Try a JPEG or PNG.`)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")!
  // JPEG has no transparency: without a white backdrop, a transparent screenshot turns black
  // and the model reads nothing.
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/jpeg", quality)
}

/** Centre-crop to a square and shrink to `size` px for a profile picture (WebP-friendly JPEG;
 * the original never leaves the device). */
export async function toAvatarDataUrl(file: File, size = 512): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error("That is not a picture this browser can read. Try a JPEG or PNG.")
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = Math.min(size, side)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
                0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/jpeg", 0.9)
}

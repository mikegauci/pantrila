// Renders the favicon, Apple touch icon and app-store PNGs from the SVGs in
// src/app and brand/, and the phone app's icons in ../mobile/assets. Run from web/: node scripts/icons.mjs
import { readFileSync, writeFileSync } from "node:fs"
import sharp from "sharp"

const png = (file, size, opts = {}) => {
  const svg = readFileSync(file)
  // Rasterise at twice the target size, then downscale for clean edges.
  const width = Number(/width="(\d+)"/.exec(svg.toString())[1])
  let img = sharp(svg, { density: (72 * 2 * size) / width }).resize(size, size)
  if (opts.flatten) img = img.flatten({ background: "#2a7a38" })
  return img.png().toBuffer()
}

// An .ico holding PNG images (supported by every current browser).
const ico = (images, sizes) => {
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size, at)
    head.writeUInt8(size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(images[i].length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += images[i].length
  })
  return Buffer.concat([head, ...images])
}

const sizes = [16, 32, 48]
writeFileSync(
  "src/app/favicon.ico",
  ico(await Promise.all(sizes.map((s) => png("src/app/icon.svg", s))), sizes),
)
// iOS rounds the corners itself, so the touch icon and store icon are full-bleed
// squares; the store icon must have no transparency.
writeFileSync("src/app/apple-icon.png", await png("brand/app-icon.svg", 180, { flatten: true }))
writeFileSync("brand/app-icon-1024.png", await png("brand/app-icon.svg", 1024, { flatten: true }))
writeFileSync("brand/android-foreground-432.png", await png("brand/android-foreground.svg", 432))
writeFileSync("brand/android-background-432.png", await png("brand/android-background.svg", 432))

// The phone app (mobile/assets): store icon and Android adaptive layers at 1024 px. The white
// foreground doubles as the one-colour themed icon and as the splash mark (on green).
const mobile = "../mobile/assets"
writeFileSync(`${mobile}/icon.png`, await png("brand/app-icon.svg", 1024, { flatten: true }))
writeFileSync(`${mobile}/android-foreground.png`, await png("brand/android-foreground.svg", 1024))
writeFileSync(`${mobile}/android-background.png`, await png("brand/android-background.svg", 1024))

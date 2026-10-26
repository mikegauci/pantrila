// Renders Google Play's store graphics into ../docs/store-assets: the 512 px app icon and the
// 1024 x 500 feature graphic (logo, name and tagline on the brand gradient). Run from web/:
// node scripts/store-art.mjs
import { readFileSync } from "node:fs"
import sharp from "sharp"

const out = "../docs/store-assets"
const icon = readFileSync("brand/app-icon.svg")
await sharp(icon, { density: 144 }).resize(512, 512).png().toFile(`${out}/play-icon-512.png`)

// The chef hat from brand/app-icon.svg in white, without its green square.
const star = "M0-1C.12-.32.32-.12 1 0C.32.12.12.32 0 1C-.12.32-.32.12-1 0C-.32-.12-.12-.32 0-1Z"
const hat = `<g transform="translate(110 100) scale(3)">
  <defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><g fill="#fff"><circle cx="33" cy="46" r="14"/><circle cx="50" cy="37" r="17"/><circle cx="67" cy="46" r="14"/><rect x="30" y="46" width="40" height="20"/><rect x="30" y="70" width="40" height="12" rx="3"/></g><path fill="#000" transform="translate(50 52) scale(13)" d="${star}"/></mask></defs>
  <rect width="100" height="100" fill="#fff" mask="url(#cut)"/>
  <path fill="#fff" transform="translate(77 22) scale(5.5)" d="${star}"/><path fill="#fff" transform="translate(84 31) scale(2.8)" d="${star}"/>
</g>`
const font = "Helvetica Neue, Helvetica, Arial, sans-serif"
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4cb85a"/><stop offset="1" stop-color="#2a7a38"/></linearGradient></defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  <circle cx="900" cy="80" r="220" fill="#fff" opacity="0.06"/><circle cx="980" cy="470" r="160" fill="#fff" opacity="0.05"/>
  ${hat}
  <text x="460" y="215" font-family="${font}" font-weight="700" font-size="84" fill="#fff">Pantrila</text>
  <text x="462" y="275" font-family="${font}" font-weight="500" font-size="34" fill="#fff" opacity="0.95">Your AI cooking companion</text>
  <text x="462" y="340" font-family="${font}" font-size="24" fill="#fff" opacity="0.85">Plan meals · Import recipes · Cook hands-free</text>
</svg>`
await sharp(Buffer.from(feature)).png().toFile(`${out}/play-feature-graphic-1024x500.png`)

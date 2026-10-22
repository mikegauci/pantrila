# Pantrila icon

A white chef hat on a green gradient (#4cb85a to #2a7a38). The big AI sparkle is
cut out of the hat so the background shows through; two small white sparkles sit
top right.

| File | Use |
| --- | --- |
| `../src/app/icon.svg` | Browser favicon (rounded square) |
| `../src/app/favicon.ico` | 16/32/48 px favicon |
| `../src/app/apple-icon.png` | 180 px iOS home-screen icon (full bleed) |
| `app-icon.svg`, `app-icon-1024.png` | App Store / Play Store master: square, full bleed, no transparency (iOS rounds the corners) |
| `android-foreground.svg` / `-432.png` | Android adaptive icon foreground, mark inside the 66 dp safe zone; also works as the one-colour themed icon |
| `android-background.svg` / `-432.png` | Android adaptive icon background |

The header logo (`../src/components/logo.tsx`) draws the same mark inline.
After editing an SVG, run `node scripts/icons.mjs` from `web/` to re-render the PNGs and the .ico.

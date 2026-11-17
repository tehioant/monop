# City Atlas card artwork

These original, layered SVGs are the editable illustration masters. Open them in Inkscape to adjust the cartography, landmark silhouettes and deck back. They were drawn as SVG paths and exported with Inkscape; no third-party images or fonts are bundled in the app.

The app bundles lossless WebP versions in `packages/app/assets/cards/`. Export illustrations at **182 × 104 px**, and `deck-back.svg` at **204 × 288 px**. For example, from the repo root (requires Inkscape and `cwebp`):

```sh
inkscape art/city-atlas/paris.svg --export-area-page --export-filename=paris.png
cwebp -lossless -exact paris.png -o packages/app/assets/cards/paris.webp
rm paris.png
```

`packages/app/src/table/cardArt.ts` lists Metro's static asset imports. Its 47 illustrations cover 31 cities, six wild faces, nine actions and the shared coin motif. Coin values, card names, countries, perks and rules are live text from the app and engine. The same back is used for the deck indicator and all hidden flights. Repeated copies of a card do not need separate binaries.

Thailand replaces the UK on screen. The four original card IDs and the country ID are kept for existing saves and multiplayer: `uk` displays as Thailand, `london` as Bangkok, `manchester` as Chiang Mai, `edinburgh` as Phuket, and `wild-uk-india` as Wild Thailand/India. Their artwork filenames use the new names.

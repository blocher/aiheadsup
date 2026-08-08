#!/usr/bin/env bash
# Compose framed App Store screenshots + iPad masters from raw captures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/store/ios/screenshots/raw"
IPHONE="$ROOT/store/ios/screenshots/iphone-6.9"
IPHONE65="$ROOT/store/ios/screenshots/iphone-6.5"
IPAD="$ROOT/store/ios/screenshots/ipad-13"
mkdir -p "$IPHONE" "$IPHONE65" "$IPAD"

# Brand background
BG='#10152d'
ACCENT='#ffe663'
WHITE='#ffffff'
FONT_BOLD='/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
FONT_SUB='/System/Library/Fonts/Supplemental/Arial Bold.ttf'

compose_portrait() {
  local src="$1" dest="$2" line1="$3" line2="${4:-}"
  # Canvas 1290x2796. Caption band on top, UI scaled into remaining space with padding.
  magick -size 1290x2796 "xc:${BG}" \
    \( "$src" -resize 1180x \) -gravity south -geometry +0+72 -composite \
    \( -size 1180x320 "xc:transparent" \
       -fill "$WHITE" -font "$FONT_BOLD" -pointsize 64 -gravity north \
       -annotate +0+36 "$line1" \
       -fill "$ACCENT" -font "$FONT_SUB" -pointsize 36 \
       -annotate +0+140 "$line2" \) \
    -gravity north -geometry +0+48 -composite \
    -strip "PNG24:$dest"
  echo "wrote $dest"
}

# Clean uploads (exact device captures) — primary App Store set
cp "$RAW/01-tutorial.png"      "$IPHONE/01-welcome.png"
cp "$RAW/02-library.png"       "$IPHONE/02-library.png"
cp "$RAW/03-pack-detail.png"   "$IPHONE/03-pack-detail.png"
cp "$RAW/04-gameplay.png"      "$IPHONE/04-gameplay-landscape.png"
cp "$RAW/05-ai-create.png"     "$IPHONE/05-ai-create.png"
cp "$RAW/06-tutorial-ai.png"   "$IPHONE/06-make-your-own.png"

# Framed marketing variants (still 1290×2796)
compose_portrait "$RAW/01-tutorial.png"    "$IPHONE/framed-01-welcome.png"     "The word is on YOUR forehead" "Friends shout the clues"
compose_portrait "$RAW/02-library.png"     "$IPHONE/framed-02-library.png"     "230+ packs. Zero setup."     "Pick one and get silly"
compose_portrait "$RAW/03-pack-detail.png" "$IPHONE/framed-03-start-round.png" "Ready, set, forehead."       "30, 60, or 90-second rounds"
compose_portrait "$RAW/05-ai-create.png"   "$IPHONE/framed-05-ai.png"          "Make a pack about anything"  "On-device AI or your own key"
compose_portrait "$RAW/06-tutorial-ai.png" "$IPHONE/framed-06-custom.png"      "Custom decks. On your phone." "Private when on-device AI is ready"

# Gameplay landscape → portrait marketing frame
magick -size 1290x2796 "xc:${BG}" \
  \( "$RAW/04-gameplay.png" -resize 1180x \) -gravity center -geometry +0+120 -composite \
  \( -size 1180x280 "xc:transparent" \
     -fill "$WHITE" -font "$FONT_BOLD" -pointsize 60 -gravity north \
     -annotate +0+24 "Tilt down if you got it" \
     -fill "$ACCENT" -font "$FONT_SUB" -pointsize 34 \
     -annotate +0+120 "Tip up to pass · race the clock" \) \
  -gravity north -geometry +0+56 -composite \
  -strip "PNG24:$IPHONE/framed-04-gameplay.png"
echo "wrote $IPHONE/framed-04-gameplay.png"

# iPad 13" class (2048×2732 portrait / 2732×2048 landscape) from native iPad captures
IPAD_RAW="$RAW/ipad"
if [[ -d "$IPAD_RAW" && -f "$IPAD_RAW/02-library.png" ]]; then
  [[ -f "$IPAD_RAW/01-tutorial.png" ]] && cp "$IPAD_RAW/01-tutorial.png" "$IPAD/01-welcome.png"
  cp "$IPAD_RAW/02-library.png"     "$IPAD/02-library.png"
  cp "$IPAD_RAW/03-pack-detail.png" "$IPAD/03-pack-detail.png"
  cp "$IPAD_RAW/04-gameplay.png"    "$IPAD/04-gameplay-landscape.png"
  cp "$IPAD_RAW/05-ai-create.png"   "$IPAD/05-ai-create.png"
  cp "$IPAD_RAW/06-tutorial-ai.png" "$IPAD/06-make-your-own.png"
  # Portrait well also accepts a fully-visible framed gameplay shot (no crop)
  magick -size 2048x2732 "xc:${BG}" \
    \( "$IPAD_RAW/04-gameplay.png" -resize 1900x1900 \) -gravity center -composite \
    -strip "PNG24:$IPAD/04-gameplay.png"
  # If welcome was missing, letterbox the iPhone welcome as a fallback
  if [[ ! -f "$IPAD/01-welcome.png" ]]; then
    magick -size 2048x2732 "xc:${BG}" \
      \( "$IPHONE/01-welcome.png" -resize 2048x2732 \) -gravity center -composite \
      -strip "PNG24:$IPAD/01-welcome.png"
  fi
  echo "wrote iPad set from raw/ipad (full-bleed, no crop)"
else
  echo "WARN: missing $IPAD_RAW — letterboxing iPhone shots to fit iPad canvas (no crop)"
  for name in 01-welcome 02-library 03-pack-detail 05-ai-create 06-make-your-own; do
    magick -size 2048x2732 "xc:${BG}" \
      \( "$IPHONE/${name}.png" -resize 2048x2732 \) -gravity center -composite \
      -strip "PNG24:$IPAD/${name}.png"
    echo "wrote $IPAD/${name}.png"
  done
  magick -size 2048x2732 "xc:${BG}" \
    \( "$RAW/04-gameplay.png" -resize 2048x2732 \) -gravity center -composite \
    -strip "PNG24:$IPAD/04-gameplay.png"
  echo "wrote $IPAD/04-gameplay.png"
fi

# iPhone 6.5" class (1242×2688 / 2688×1242) — required by many ASC upload wells
for f in "$IPHONE"/*.png; do
  base="$(basename "$f")"
  if [[ "$base" == *landscape* ]]; then
    magick "$f" -resize 2688x1242! -strip "PNG24:$IPHONE65/$base"
  else
    magick "$f" -resize 1242x2688! -strip "PNG24:$IPHONE65/$base"
  fi
  echo "wrote $IPHONE65/$base"
done

# Remove obsolete non-standard raw
rm -f "$RAW/05-ai-settings-browser.png"

magick identify "$IPHONE"/*.png "$IPHONE65"/*.png "$IPAD"/*.png | sed 's|.*/store/ios/|store/ios/|'

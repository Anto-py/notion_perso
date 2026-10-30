#!/usr/bin/env bash
#
# Dérive les PNG de public/icons/ depuis public/icons/icon.svg.
#
# Aucune dépendance installée : le rendu est fait par le Chrome de la machine,
# en mode headless, sur une page qui pose le SVG à la taille voulue (procédé
# repris de tableau_de_bord_ereferent). Les PNG sont versionnés : le serveur
# ne convertit rien, il sert des fichiers.
#
#   bash scripts/generate_icons.sh
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_svg="$root/public/icons/icon.svg"
out="$root/public/icons"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -f "$source_svg" ] || { echo "Introuvable : $source_svg" >&2; exit 1; }
[ -x "$chrome" ] || { echo "Chrome introuvable : $chrome" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$source_svg" "$work/icon.svg"

# $1 nom du fichier, $2 côté en pixels, $3 part du côté occupée par le dessin.
# Sous le masque d'Android, seul un cercle des quatre cinquièmes de la largeur
# est garanti visible : la variante maskable réduit le dessin, le fond teal
# occupant le reste. Les autres remplissent le carré.
render() {
  local name="$1" side="$2" part="$3"
  local size margin
  size=$(python3 -c "print(round($side * $part, 2))")
  margin=$(python3 -c "print(round($side * (1 - $part) / 2, 2))")
  cat > "$work/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #127676; }
  body { width: ${side}px; height: ${side}px; overflow: hidden; }
  img { position: absolute; left: ${margin}px; top: ${margin}px; width: ${size}px; height: ${size}px; }
</style>
<img src="icon.svg" alt="">
HTML
  "$chrome" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$side,$side" \
    --screenshot="$out/$name" "$work/page.html" >/dev/null 2>&1
  echo "  $name  ${side}×${side}"
}

echo "Icônes dérivées de $(basename "$source_svg") :"
render "icon-32.png"            32 1
render "icon-192.png"          192 1
render "icon-512.png"          512 1
render "icon-maskable-512.png" 512 0.78
render "apple-touch-icon.png"  180 1

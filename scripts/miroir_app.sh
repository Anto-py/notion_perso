#!/usr/bin/env bash
#
# Fabrique « Miroir notion.app », lanceur de la consultation du miroir à poser
# dans le Dock, sur le bureau ou dans le Finder. Ouvrir l'app lance
# scripts/miroir_consulter.sh en arrière-plan (l'onglet s'ouvre quand le
# serveur répond) ; cliquer sur l'icône déjà ouverte rouvre l'onglet ; quitter
# l'app (Cmd + Q) arrête le serveur. Journal : ~/notion_perso_miroir/journal/consulter.log.
#
#   bash scripts/miroir_app.sh                  # dans ~/Applications
#   bash scripts/miroir_app.sh <dossier cible>
#
# L'app connaît le chemin du dépôt : la refabriquer si le dépôt déménage.
#
set -euo pipefail

projet="$(cd "$(dirname "$0")/.." && pwd)"
cible="${1:-$HOME/Applications}/Miroir notion.app"
port="${MIROIR_PORT:-3100}"
travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT

# do shell script n'a qu'un PATH minimal : node, npm et git n'y sont pas. Il
# attend aussi que sa sortie se ferme : « cd … && nohup … & » enverrait en
# arrière-plan un sous-shell qui la garde ouverte, et l'app resterait bloquée
# dans « on run », sourde à Cmd + Q. D'où cd puis nohup, séparés.
cat > "$travail/miroir.applescript" <<EOF
property projet : "$projet"
property port : "$port"
property chemins : "export PATH=/usr/local/bin:/opt/homebrew/bin:\$PATH; "
property lance : ""

on ecoute()
	return (do shell script "/usr/sbin/lsof -tiTCP:" & port & " -sTCP:LISTEN || true") is not ""
end ecoute

on run
	if ecoute() then
		do shell script "open http://127.0.0.1:" & port
	else
		set lance to do shell script chemins & "cd " & quoted form of projet & " || exit 1; nohup bash scripts/miroir_consulter.sh > \"\$HOME/notion_perso_miroir/journal/consulter.log\" 2>&1 < /dev/null & echo \$!"
	end if
end run

on reopen
	if ecoute() then do shell script "open http://127.0.0.1:" & port
end reopen

-- Pendant la construction, le script a des enfants (npm, next build) ; une
-- fois prêt, il est devenu le serveur (exec node). Le port couvre un serveur
-- lancé hors de l'app.
on quit
	if lance is not "" then do shell script "/usr/bin/pkill -P " & lance & " || true; kill " & lance & " 2>/dev/null || true"
	do shell script "/usr/sbin/lsof -tiTCP:" & port & " -sTCP:LISTEN | xargs kill 2>/dev/null || true"
	set lance to ""
	continue quit
end quit
EOF

rm -rf "$cible"
mkdir -p "$(dirname "$cible")"
osacompile -s -o "$cible" "$travail/miroir.applescript"

# Icône : celle de l'application, déclinée aux tailles d'un .icns.
jeu="$travail/miroir.iconset"
mkdir "$jeu"
source_png="$projet/public/icons/icon-512.png"
for taille in 16 32 128 256 512; do
  sips -z "$taille" "$taille" "$source_png" --out "$jeu/icon_${taille}x${taille}.png" >/dev/null
  double=$(( taille * 2 ))
  sips -z "$double" "$double" "$source_png" --out "$jeu/icon_${taille}x${taille}@2x.png" >/dev/null
done
iconutil -c icns "$jeu" -o "$cible/Contents/Resources/applet.icns"
# macOS récent lit l'icône dans Assets.car (CFBundleIconName) avant le .icns.
rm -f "$cible/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$cible/Contents/Info.plist" 2>/dev/null || true
# Toucher au paquet invalide la signature locale posée par osacompile.
codesign --force --sign - "$cible" 2>/dev/null
touch "$cible"

echo "Prêt : $cible (à glisser dans le Dock ou sur le bureau)"

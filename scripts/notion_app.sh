#!/usr/bin/env bash
#
# Fabrique « Notion perso.app », l'app Mac synchronisée (SPECS.md, « Instance
# Mac »). L'ouvrir lance scripts/notion_lancer.sh en arrière-plan (mise à jour,
# serveur, puis fenêtre Chrome en mode application) ; cliquer sur l'icône déjà
# ouverte rouvre la fenêtre ; fermer la fenêtre, Cmd + Q dans la fenêtre ou sur
# l'app arrête tout (choix d'Antonin du 2026-11-01). Rien ne tourne app fermée.
# Journal : <dossier>/journal/lancer.log.
#
#   bash scripts/notion_app.sh                  # dans /Applications
#   bash scripts/notion_app.sh <dossier cible>
#
# L'app connaît le chemin du dépôt et le dossier des données
# (NOTION_APP_DOSSIER, ~/notion_perso_app) : la refabriquer s'ils déménagent.
#
set -euo pipefail

projet="$(cd "$(dirname "$0")/.." && pwd)"
dossier="${NOTION_APP_DOSSIER:-$HOME/notion_perso_app}"
cible="${1:-/Applications}/Notion perso.app"
port="${NOTION_APP_PORT:-3200}"
port_chrome="${NOTION_APP_CHROME_PORT:-3201}"
travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT

# Reprend scripts/miroir_app.sh : PATH minimal de do shell script, cd puis
# nohup séparés pour que « on run » rende la main. En plus, « on idle » suit
# la fenêtre : Chrome ne s'arrête pas avec sa dernière fenêtre sur macOS, d'où
# le compte des pages sur le port de débogage du profil dédié ; une fois une
# page vue, zéro page (fenêtre fermée ou Chrome quitté) arrête tout. Un
# lanceur mort avant toute fenêtre (échec, déjà notifié) arrête l'app aussi.
cat > "$travail/notion.applescript" <<EOF
property projet : "$projet"
property dossier : "$dossier"
property port : "$port"
property portChrome : "$port_chrome"
property chemins : "export PATH=/usr/local/bin:/opt/homebrew/bin:\$PATH; export NOTION_APP_DOSSIER=" & quoted form of dossier & "; "
property lance : ""
property vue : false

on ecoute()
	return (do shell script "/usr/sbin/lsof -tiTCP:" & port & " -sTCP:LISTEN || true") is not ""
end ecoute

on pages()
	return (do shell script "/usr/bin/curl -fsS --max-time 1 http://127.0.0.1:" & portChrome & "/json/list 2>/dev/null | /usr/bin/grep -c '\"type\": \"page\"' || true") as integer
end pages

on fenetre()
	do shell script chemins & "cd " & quoted form of projet & " && bash scripts/notion_lancer.sh --fenetre"
end fenetre

on run
	set vue to false
	set lance to ""
	if ecoute() then
		fenetre()
	else
		set lance to do shell script chemins & "mkdir -p " & quoted form of (dossier & "/journal") & "; cd " & quoted form of projet & " || exit 1; nohup bash scripts/notion_lancer.sh > " & quoted form of (dossier & "/journal/lancer.log") & " 2>&1 < /dev/null & echo \$!"
	end if
end run

on reopen
	if ecoute() then fenetre()
end reopen

on idle
	if pages() > 0 then
		set vue to true
	else if vue then
		quit
	else if lance is not "" then
		if (do shell script "kill -0 " & lance & " 2>/dev/null && echo oui || echo non") is "non" then quit
	end if
	return 2
end idle

-- Pendant la construction, le lanceur a des enfants (npm, next build) ; une
-- fois prêt, il est devenu le serveur (exec node). Le port couvre un serveur
-- lancé hors de l'app ; le profil, la fenêtre restée sans page.
on quit
	if lance is not "" then do shell script "/usr/bin/pkill -P " & lance & " || true; kill " & lance & " 2>/dev/null || true"
	do shell script "/usr/sbin/lsof -tiTCP:" & port & " -sTCP:LISTEN | xargs kill 2>/dev/null || true"
	do shell script "/usr/bin/pkill -f -- " & quoted form of ("--user-data-dir=" & dossier & "/chrome") & " || true"
	set lance to ""
	set vue to false
	continue quit
end quit
EOF

rm -rf "$cible"
mkdir -p "$(dirname "$cible")"
osacompile -s -o "$cible" "$travail/notion.applescript"

# Icône : celle de l'application, déclinée aux tailles d'un .icns.
jeu="$travail/notion.iconset"
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

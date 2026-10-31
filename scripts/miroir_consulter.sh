#!/usr/bin/env bash
#
# Consultation du miroir sur le Mac : lance, à la demande, l'application contre
# la base notion_perso_miroir, avec un rôle Postgres qui lit tout et n'écrit
# que ses sessions (scripts/miroir_droits.sql). Rien n'est écrit sur le VPS ;
# purge de la corbeille et nettoyage des médias échouent sans rien effacer.
#
#   bash scripts/miroir_consulter.sh     # http://127.0.0.1:3100, Ctrl + C pour arrêter
#
# Le code vient d'un second clone, $MIROIR_DOSSIER/app, calé sur le plus récent
# déploiement Coolify dont la dernière migration est celle du miroir : le dump
# d'une nuit qui précède un déploiement migrant se lit avec le code d'avant.
# Connexion avec le compte de production. 127.0.0.1 et non localhost : un
# cookie vaut pour tous les ports d'un hôte, et celui du miroir remplacerait la
# session du serveur de développement.
#
# Réglages dans ~/notion_perso_miroir/miroir.conf, ceux de miroir.sh plus :
#   MIROIR_COOLIFY=https://<instance Coolify>/api/v1
#   MIROIR_APP=<uuid de l'application Coolify>
# Facultatifs : MIROIR_PORT (3100), MIROIR_TROUSSEAU (coolify-api, service du
# jeton dans le trousseau macOS), MIROIR_DEPOT (dépôt public du code).
#
set -euo pipefail

export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
export PGOPTIONS="-c client_min_messages=warning"

dossier="${MIROIR_DOSSIER:-$HOME/notion_perso_miroir}"
ici="$(cd "$(dirname "$0")" && pwd)"
# Lancé par « Miroir notion.app » (scripts/miroir_app.sh), il n'a pas de
# terminal : les étapes qui comptent passent aussi en notification.
notifier() {
  osascript -e "display notification \"$1\" with title \"Miroir notion_perso\"" >/dev/null 2>&1 || true
}
echec() { echo "Échec : $1" >&2; notifier "Échec : $1"; exit 1; }

conf="$dossier/miroir.conf"
[ -f "$conf" ] || echec "réglages introuvables ($conf)"
# shellcheck source=/dev/null
source "$conf"
: "${MIROIR_COOLIFY:?}" "${MIROIR_APP:?}"
base="${MIROIR_BASE:-notion_perso_miroir}"
port="${MIROIR_PORT:-3100}"
depot="${MIROIR_DEPOT:-https://github.com/Anto-py/notion_perso.git}"
app="$dossier/app"
construit="$dossier/journal/app_commit"
verrou_npm="$dossier/journal/app_lock"

psql -d "$base" -Atc 'select 1' >/dev/null 2>&1 \
  || echec "base $base introuvable : lancer d'abord bash scripts/miroir.sh --force"
if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echec "port $port déjà occupé"
fi

# Drizzle range dans created_at le champ « when » du journal des migrations.
derniere="$(psql -d "$base" -Atc 'select max(created_at) from drizzle.__drizzle_migrations')"

[ -d "$app/.git" ] || git clone --quiet "$depot" "$app"
git -C "$app" fetch --quiet origin

# Le jeton passe par l'entrée standard : en argument, ps l'afficherait.
jeton="$(security find-generic-password -s "${MIROIR_TROUSSEAU:-coolify-api}" -w)" \
  || echec "jeton Coolify absent du trousseau"
deploiements="$(printf 'Authorization: Bearer %s\n' "$jeton" \
  | curl -fsS -H @- "$MIROIR_COOLIFY/deployments/applications/$MIROIR_APP?take=20")" \
  || echec "API Coolify injoignable"
unset jeton
commits="$(node -e '
  const { deployments } = JSON.parse(process.argv[1]);
  for (const d of deployments) if (d.status === "finished" && d.commit) console.log(d.commit);
' "$deploiements")"

derniere_du() {
  git -C "$app" show "$1:src/db/migrations/meta/_journal.json" 2>/dev/null \
    | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).entries.at(-1).when))'
}

choisi=""
for commit in $commits; do
  if [ "$(derniere_du "$commit" || true)" = "$derniere" ]; then
    choisi="$commit"
    break
  fi
done
[ -n "$choisi" ] || echec "aucun des 20 derniers déploiements ne porte la dernière migration du miroir ($derniere)"

if [ "$(cat "$construit" 2>/dev/null || true)" != "$choisi" ]; then
  echo "Construction de ${choisi:0:7}…"
  notifier "Construction de la version ${choisi:0:7}, une à deux minutes"
  git -C "$app" checkout --quiet --detach "$choisi"
  empreinte="$(shasum "$app/package-lock.json" | cut -d' ' -f1)"
  if [ "$(cat "$verrou_npm" 2>/dev/null || true)" != "$empreinte" ]; then
    (cd "$app" && npm ci --no-audit --no-fund)
    echo "$empreinte" > "$verrou_npm"
  fi
  # Comme dans le Dockerfile : le module de base exige une adresse dès
  # l'import, le build ne se connecte pas.
  (cd "$app" && NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build:build@localhost:5432/build npm run build)
  # server.js n'embarque ni public ni .next/static.
  rm -rf "$app/.next/standalone/public" "$app/.next/standalone/.next/static"
  cp -R "$app/public" "$app/.next/standalone/public"
  cp -R "$app/.next/static" "$app/.next/standalone/.next/static"
  echo "$choisi" > "$construit"
fi

psql -d "$base" -q -v ON_ERROR_STOP=1 -f "$ici/miroir_droits.sql"

adresse="http://127.0.0.1:$port"
(
  for _ in $(seq 60); do
    if curl -fsS -o /dev/null "$adresse/login" 2>/dev/null; then
      open "$adresse"
      exit 0
    fi
    sleep 1
  done
) &

echo "Miroir au commit ${choisi:0:7} sur $adresse, Ctrl + C pour arrêter."
cd "$app/.next/standalone"
exec env -u MIGRATE_ON_START NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  PORT="$port" HOSTNAME=127.0.0.1 \
  DATABASE_URL="postgres://notion_miroir_lecteur@localhost:5432/$base" \
  UPLOAD_DIR="$dossier/uploads" \
  node server.js

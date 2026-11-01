#!/usr/bin/env bash
#
# Instance Mac (SPECS.md, « Synchronisation avec l'app Mac ») : met le code au
# niveau de la production, construit si besoin, puis lance le serveur sur
# 127.0.0.1 contre la base locale, synchronisation active, et ouvre la fenêtre.
# Lancé par « Notion perso.app » (scripts/notion_app.sh), ou à la main :
#
#   bash scripts/notion_lancer.sh             # Ctrl + C pour arrêter
#   bash scripts/notion_lancer.sh --fenetre   # rouvre seulement la fenêtre
#
# Premier lancement dans un terminal : il demande le compte local (identifiant,
# mot de passe), que le serveur crée au démarrage ; le compte ne voyage pas.
#
# Mise à jour d'abord (choix d'Antonin du 2026-11-01) : le commit est celui du
# dernier déploiement Coolify réussi ; construit à part, il ne remplace la
# version courante qu'une fois prêt, et les migrations locales passent au
# démarrage. Les modifications en attente restent dans la base locale et
# partent avec la nouvelle version : l'ancienne serait refusée par le serveur
# (schéma ou commit différent). Sans réseau, la version déjà construite sert.
#
# Sauvegardes (SPECS.md, « Sauvegardes, par le lanceur ») : un dump de la base
# locale au premier lancement du jour et avant chaque mise à jour, serveur
# arrêté, donc avant toute migration locale ; 7 quotidiennes et 3 d'avant mise
# à jour gardées. Pas de migration sans dump : un dump raté reporte la mise à
# jour. Synchronisation suspendue et version neuve : une fenêtre demande
# l'accord, la version actuelle étant gardée par défaut.
#
# Données hors du vault, dans $NOTION_APP_DOSSIER (~/notion_perso_app) : clone
# (app/), versions construites (versions/), médias (uploads/), médias effacés
# depuis moins de 30 jours (quarantaine/), dumps (sauvegardes/), profil Chrome
# (chrome/), journal (journal/). Réglages dans app.conf :
#   NOTION_APP_DISTANT=https://<app web>           # serveur de synchronisation
#   NOTION_APP_COOLIFY=https://<instance Coolify>/api/v1
#   NOTION_APP_COOLIFY_APP=<uuid de l'application Coolify>
# Facultatifs : NOTION_APP_PORT (3200), NOTION_APP_CHROME_PORT (3201, port de
# débogage du profil Chrome, lu par l'applet), NOTION_APP_BASE
# (notion_perso_local), NOTION_APP_JETON (notion-perso-sync, service du jeton
# de synchronisation au trousseau), NOTION_APP_COOLIFY_JETON (coolify-api),
# NOTION_APP_DEPOT (dépôt public), NOTION_APP_COMMIT (commit imposé, sans
# Coolify : essais).
#
set -euo pipefail

export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
export PGOPTIONS="-c client_min_messages=warning"

dossier="${NOTION_APP_DOSSIER:-$HOME/notion_perso_app}"
# Sans terminal (lancé par l'app), les étapes qui comptent passent aussi en
# notification.
notifier() {
  osascript -e "display notification \"$1\" with title \"Notion perso\"" >/dev/null 2>&1 || true
}
echec() { echo "Échec : $1" >&2; notifier "Échec : $1"; exit 1; }

conf="$dossier/app.conf"
[ -f "$conf" ] || echec "réglages introuvables ($conf)"
# shellcheck source=/dev/null
source "$conf"
: "${NOTION_APP_DISTANT:?}"
port="${NOTION_APP_PORT:-3200}"
port_chrome="${NOTION_APP_CHROME_PORT:-3201}"
base="${NOTION_APP_BASE:-notion_perso_local}"
depot="${NOTION_APP_DEPOT:-https://github.com/Anto-py/notion_perso.git}"
adresse="http://127.0.0.1:$port"
app="$dossier/app"
versions="$dossier/versions"
courante="$versions/courante"
verrou_npm="$dossier/journal/app_lock"
mkdir -p "$dossier/journal" "$dossier/uploads" "$versions"

# Profil dédié : la session ne se mêle à aucune autre sur 127.0.0.1. Le port
# de débogage (local seulement) dit à l'applet si une fenêtre reste ouverte ;
# Chrome ne s'arrête pas avec sa dernière fenêtre sur macOS.
fenetre() {
  open -na "Google Chrome" --args \
    --user-data-dir="$dossier/chrome" \
    --remote-debugging-port="$port_chrome" \
    --no-first-run --no-default-browser-check \
    --app="$adresse"
}

if [ "${1:-}" = "--fenetre" ]; then
  fenetre
  exit 0
fi

[ -d "/Applications/Google Chrome.app" ] || echec "Google Chrome introuvable dans /Applications"
if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echec "port $port déjà occupé"
fi

# --- Base locale ----------------------------------------------------------------

if ! pg_isready -q -h localhost; then
  open -a Postgres
  for _ in $(seq 30); do pg_isready -q -h localhost && break; sleep 1; done
  pg_isready -q -h localhost || echec "Postgres.app ne répond pas"
fi
if ! psql -d postgres -Atc "select 1 from pg_database where datname = '$base'" | grep -q 1; then
  createdb "$base"
fi

# Le serveur crée le compte au démarrage (db/bootstrap.ts) s'il n'en trouve
# aucun ; il lui faut alors un identifiant et un mot de passe, demandés ici
# s'ils ne sont pas déjà dans l'environnement.
comptes="$(psql -d "$base" -Atc 'select count(*) from users' 2>/dev/null || echo 0)"
if [ "$comptes" = "0" ] && { [ -z "${INITIAL_USERNAME:-}" ] || [ -z "${INITIAL_PASSWORD:-}" ]; }; then
  [ -t 0 ] || echec "aucun compte local : lancer une première fois bash scripts/notion_lancer.sh dans un terminal"
  read -rp "Compte local, identifiant : " INITIAL_USERNAME
  read -rsp "Mot de passe : " INITIAL_PASSWORD; echo
  [ -n "$INITIAL_USERNAME" ] && [ -n "$INITIAL_PASSWORD" ] || echec "identifiant et mot de passe requis"
  export INITIAL_USERNAME INITIAL_PASSWORD
fi

# --- Sauvegardes ----------------------------------------------------------------

# Écrites en .partiel puis renommées : un dump interrompu ne passe jamais pour
# bon. Les médias n'y sont pas, d'où la quarantaine (QUARANTINE_DIR).
sauvegardes="$dossier/sauvegardes"
mkdir -p "$sauvegardes"
rm -f "$sauvegardes"/*.partiel
# Lue par la ligne d'état (BACKUP_ALERT) : daily_failed ou update_deferred.
alerte_sauvegarde=""

# Une base jamais migrée n'a rien à sauvegarder.
base_migree() {
  [ "$(psql -d "$base" -Atc "select to_regclass('drizzle.__drizzle_migrations') is not null" 2>/dev/null)" = "t" ]
}

# sauvegarder <préfixe> : quotidienne, ou avant_maj_<commit court>.
sauvegarder() {
  local fichier
  fichier="$sauvegardes/${1}_$(date +%Y%m%d_%H%M).dmp"
  if pg_dump -Fc -d "$base" -f "$fichier.partiel"; then
    mv "$fichier.partiel" "$fichier"
  else
    rm -f "$fichier.partiel"
    return 1
  fi
}

# tourner <motif> <nombre> : garde les plus récentes par la date du nom (ses
# deux derniers champs), l'ordre alphabétique rangeant les avant_maj par commit.
tourner() {
  find "$sauvegardes" -maxdepth 1 -type f -name "$1" \
    | awk -F_ '{ print $(NF-1) "_" $NF "\t" $0 }' | sort -r | tail -n +"$(($2 + 1))" | cut -f2- \
    | while IFS= read -r ancienne; do rm -f "$ancienne"; done
}

if base_migree && ! compgen -G "$sauvegardes/quotidienne_$(date +%Y%m%d)_*.dmp" >/dev/null; then
  if sauvegarder quotidienne; then
    tourner "quotidienne_*.dmp" 7
  else
    notifier "Sauvegarde du jour impossible (journal/lancer.log)"
    alerte_sauvegarde=daily_failed
  fi
fi

jeton_sync="$(security find-generic-password -s "${NOTION_APP_JETON:-notion-perso-sync}" -w 2>/dev/null)" \
  || echec "jeton de synchronisation absent du trousseau (service ${NOTION_APP_JETON:-notion-perso-sync})"

# --- Version --------------------------------------------------------------------

actuelle="$(readlink "$courante" 2>/dev/null || true)"

dernier_deploiement() {
  local jeton reponse
  jeton="$(security find-generic-password -s "${NOTION_APP_COOLIFY_JETON:-coolify-api}" -w 2>/dev/null)" || return 1
  # Le jeton passe par l'entrée standard : en argument, ps l'afficherait.
  reponse="$(printf 'Authorization: Bearer %s\n' "$jeton" \
    | curl -fsS --max-time 10 -H @- "$NOTION_APP_COOLIFY/deployments/applications/$NOTION_APP_COOLIFY_APP?take=10")" || return 1
  node -e '
    const { deployments } = JSON.parse(process.argv[1]);
    const d = deployments.find((d) => d.status === "finished" && d.commit);
    if (!d) process.exit(1);
    console.log(d.commit);
  ' "$reponse"
}

if [ -n "${NOTION_APP_COMMIT:-}" ]; then
  choisi="$NOTION_APP_COMMIT"
elif choisi="$(dernier_deploiement)"; then
  :
elif [ -n "$actuelle" ]; then
  echo "Coolify injoignable : version ${actuelle:0:7} gardée."
  choisi="$actuelle"
else
  echec "premier lancement sans réseau : aucune version construite"
fi

# Suspendue et version neuve (choix d'Antonin du 2026-11-01) : « Garder la
# version actuelle » par défaut, retenu aussi sans réponse au bout d'une minute
# ou sans écran. Table settings absente (avant 0010) : synchronisation active.
suspendue() {
  [ "$(psql -d "$base" -Atc "select 1 from settings where key = 'sync.suspended'" 2>/dev/null)" = "1" ]
}
if [ "$choisi" != "$actuelle" ] && [ -n "$actuelle" ] && suspendue; then
  reponse="$(osascript -e "display dialog \"La synchronisation est suspendue. Mettre à jour vers ${choisi:0:7} ?\" with title \"Notion perso\" buttons {\"Mettre à jour\", \"Garder la version actuelle\"} default button \"Garder la version actuelle\" giving up after 60" 2>/dev/null || true)"
  case "$reponse" in
    *"button returned:Mettre à jour"*) echo "Synchronisation suspendue : mise à jour acceptée." ;;
    *) echo "Synchronisation suspendue : version ${actuelle:0:7} gardée."; choisi="$actuelle" ;;
  esac
fi

# Appelée dans un if, la fonction ne profite plus de set -e : chaque étape
# s'arrête d'elle-même au premier échec.
construire() {
  if [ ! -d "$app/.git" ]; then git clone --quiet "$depot" "$app" || return 1; fi
  git -C "$app" fetch --quiet origin || return 1
  git -C "$app" checkout --quiet --detach "$choisi" || return 1
  local empreinte
  empreinte="$(shasum "$app/package-lock.json" | cut -d' ' -f1)" || return 1
  if [ "$(cat "$verrou_npm" 2>/dev/null || true)" != "$empreinte" ]; then
    (cd "$app" && npm ci --no-audit --no-fund) || return 1
    echo "$empreinte" > "$verrou_npm"
  fi
  # Comme dans le Dockerfile : le module de base exige une adresse dès
  # l'import, le build ne se connecte pas.
  (cd "$app" && NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build:build@localhost:5432/build npm run build) || return 1
  # server.js n'embarque ni public, ni .next/static, ni les migrations que lit
  # db/bootstrap.ts : mêmes copies que la cible runner du Dockerfile.
  local neuve="$versions/.$choisi"
  rm -rf "$neuve"
  cp -R "$app/.next/standalone" "$neuve" \
    && cp -R "$app/public" "$neuve/public" \
    && cp -R "$app/.next/static" "$neuve/.next/static" \
    && mkdir -p "$neuve/src/db" \
    && cp -R "$app/src/db/migrations" "$neuve/src/db/migrations" \
    || return 1
  rm -rf "${versions:?}/$choisi"
  mv "$neuve" "$versions/$choisi"
}

if [ "$choisi" != "$actuelle" ]; then
  # Une version gardée en secours (celle qu'on a quittée) resert telle quelle.
  if [ -f "$versions/$choisi/server.js" ]; then
    echo "Version ${choisi:0:7} déjà construite."
  else
    echo "Mise à jour vers ${choisi:0:7}…"
    notifier "Mise à jour vers la version ${choisi:0:7}, une à deux minutes"
  fi
  if [ -f "$versions/$choisi/server.js" ] || construire; then
    # Pas de migration sans sauvegarde : le dump fige la base juste avant la
    # bascule ; raté, la version courante démarre et la mise à jour attend.
    if base_migree && ! sauvegarder "avant_maj_${choisi:0:7}"; then
      notifier "Mise à jour reportée : sauvegarde impossible (journal/lancer.log)"
      alerte_sauvegarde=update_deferred
      [ -n "$actuelle" ] || echec "sauvegarde impossible avant la première version"
      choisi="$actuelle"
    else
      ln -sfn "$choisi" "$courante"
      tourner "avant_maj_*.dmp" 3
      # Garder la version qu'on quitte, en secours ; effacer les plus anciennes.
      for v in "$versions"/*; do
        nom="$(basename "$v")"
        [ "$nom" = courante ] || [ "$nom" = "$choisi" ] || [ "$nom" = "$actuelle" ] || rm -rf "$v"
      done
    fi
  elif [ -n "$actuelle" ]; then
    notifier "Mise à jour en échec, version ${actuelle:0:7} gardée (journal/lancer.log)"
    choisi="$actuelle"
  else
    echec "construction en échec (journal/lancer.log)"
  fi
fi

# --- Serveur --------------------------------------------------------------------

(
  for _ in $(seq 60); do
    if curl -fsS -o /dev/null "$adresse/login" 2>/dev/null; then
      fenetre
      exit 0
    fi
    sleep 1
  done
) &

echo "Notion perso ${choisi:0:7} sur $adresse, Ctrl + C pour arrêter."
cd "$courante"
# SOURCE_COMMIT : le commit que la synchronisation annonce au serveur.
exec env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 MIGRATE_ON_START=1 \
  PORT="$port" HOSTNAME=127.0.0.1 \
  DATABASE_URL="postgres://$(whoami)@localhost:5432/$base" \
  UPLOAD_DIR="$dossier/uploads" QUARANTINE_DIR="$dossier/quarantaine" \
  BACKUP_DIR="$sauvegardes" BACKUP_ALERT="$alerte_sauvegarde" \
  SYNC_REMOTE_URL="$NOTION_APP_DISTANT" SYNC_TOKEN="$jeton_sync" \
  SOURCE_COMMIT="$choisi" \
  node server.js

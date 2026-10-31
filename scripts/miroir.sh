#!/usr/bin/env bash
#
# Miroir de la production sur le Mac (second étage des sauvegardes).
#
# Récupère le dernier dump quotidien que Coolify laisse sur le VPS et la copie
# des médias, puis restaure ce dump dans une base locale. La connexion SSH ne
# fait que lire : rien n'est écrit sur le VPS.
#
# Lancé par un LaunchAgent à l'ouverture de session puis toutes les 6 h, il ne
# copie que si la dernière copie réussie a plus de MIROIR_INTERVALLE_H heures :
# le Mac est éteint la nuit, le dump tombe à 2 h UTC.
#
#   bash scripts/miroir.sh            # copie si elle est due
#   bash scripts/miroir.sh --force    # copie maintenant
#
# Réglages dans ~/notion_perso_miroir/miroir.conf, hors dépôt :
#   MIROIR_HOTE=root@<adresse du VPS>
#   MIROIR_CLE=$HOME/.ssh/<clé sans phrase de passe>
#   MIROIR_DUMPS=/data/coolify/backups/databases/<équipe>/<base>
#   MIROIR_UPLOADS=/var/lib/docker/volumes/<volume>/_data
# Facultatifs : MIROIR_BASE (notion_perso_miroir), MIROIR_GARDER (5 dumps),
# MIROIR_INTERVALLE_H (20), MIROIR_ALERTE_J (3 jours sans copie réussie).
#
set -euo pipefail

# launchd ne transmet qu'un PATH minimal.
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# Tait les NOTICE de dropdb --if-exists, garde avertissements et erreurs.
export PGOPTIONS="-c client_min_messages=warning"

dossier="${MIROIR_DOSSIER:-$HOME/notion_perso_miroir}"
journal="$dossier/journal/miroir.log"
marque="$dossier/journal/derniere_copie"
mkdir -p "$dossier/dumps" "$dossier/uploads" "$dossier/journal"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$journal"; }

notifier() {
  osascript -e "display notification \"$1\" with title \"Miroir notion_perso\"" >/dev/null 2>&1 || true
}

echec() {
  log "ÉCHEC : $1"
  notifier "Échec : $1"
  exit 1
}

conf="$dossier/miroir.conf"
[ -f "$conf" ] || echec "réglages introuvables ($conf)"
# shellcheck source=/dev/null
source "$conf"
: "${MIROIR_HOTE:?}" "${MIROIR_CLE:?}" "${MIROIR_DUMPS:?}" "${MIROIR_UPLOADS:?}"
base="${MIROIR_BASE:-notion_perso_miroir}"
garder="${MIROIR_GARDER:-5}"
intervalle_h="${MIROIR_INTERVALLE_H:-20}"
alerte_j="${MIROIR_ALERTE_J:-3}"

# Le miroir est effacé à chaque copie : jamais sur une base qui porte du travail.
case "$base" in
  notion_perso|notion_perso_dev) echec "nom de base réservé : $base" ;;
esac

# Un verrou de plus de deux heures vient d'un Mac éteint en pleine copie.
verrou="$dossier/journal/.verrou"
if [ -d "$verrou" ] && [ -n "$(find "$verrou" -maxdepth 0 -mmin +120)" ]; then
  rmdir "$verrou"
fi
mkdir "$verrou" 2>/dev/null || exit 0
trap 'rmdir "$verrou"' EXIT

age_s=-1
[ -f "$marque" ] && age_s=$(( $(date +%s) - $(stat -f %m "$marque") ))
if [ "${1:-}" != "--force" ] && [ "$age_s" -ge 0 ] && [ "$age_s" -lt $(( intervalle_h * 3600 )) ]; then
  exit 0
fi

distant() { ssh -i "$MIROIR_CLE" -o BatchMode=yes -o ConnectTimeout=15 "$MIROIR_HOTE" "$@"; }
copier() { rsync -rt -e "ssh -i $MIROIR_CLE -o BatchMode=yes -o ConnectTimeout=15" "$@"; }

# À l'ouverture de session, le réseau peut arriver après le LaunchAgent.
essai=0
until distant true 2>/dev/null; do
  essai=$(( essai + 1 ))
  if [ "$essai" -ge 6 ]; then
    log "VPS injoignable, nouvel essai au prochain passage"
    if [ "$age_s" -ge $(( alerte_j * 86400 )) ]; then
      notifier "Aucune copie réussie depuis $(( age_s / 86400 )) jours"
    fi
    exit 0
  fi
  sleep 20
done

dump_distant="$(distant "ls -1t '$MIROIR_DUMPS'/*.dmp 2>/dev/null | head -1")"
[ -n "$dump_distant" ] || echec "aucun dump sur le VPS ($MIROIR_DUMPS)"
copier "$MIROIR_HOTE:$dump_distant" "$dossier/dumps/" || echec "copie du dump"
dump="$dossier/dumps/$(basename "$dump_distant")"
pg_restore -l "$dump" >/dev/null 2>&1 || echec "dump illisible : $(basename "$dump")"

# Sans --delete : un média purgé sur le VPS reste sur le Mac.
copier "$MIROIR_HOTE:$MIROIR_UPLOADS/" "$dossier/uploads/" || echec "copie des médias"

# Postgres.app peut démarrer après l'ouverture de session.
essai=0
until pg_isready -q; do
  essai=$(( essai + 1 ))
  [ "$essai" -ge 12 ] && echec "Postgres local injoignable, dump et médias copiés"
  sleep 5
done

# Restauré à côté, puis substitué : une restauration ratée laisse l'ancien miroir.
neuf="${base}_neuf"
dropdb --if-exists "$neuf"
createdb "$neuf"
if ! pg_restore --no-owner --no-acl --exit-on-error -d "$neuf" "$dump" 2>> "$journal"; then
  dropdb --if-exists "$neuf"
  echec "restauration de $(basename "$dump")"
fi
pages="$(psql -d "$neuf" -At -c 'select count(*) from pages')"
medias="$(psql -d "$neuf" -At -c 'select count(*) from media')"
[ "$pages" -gt 0 ] || { dropdb --if-exists "$neuf"; echec "dump restauré sans aucune page"; }
dropdb --if-exists --force "$base"
psql -d postgres -q -c "alter database \"$neuf\" rename to \"$base\""

ls -1t "$dossier/dumps"/*.dmp | tail -n +$(( garder + 1 )) | while read -r ancien; do
  rm -f -- "$ancien"
done

fichiers="$(find "$dossier/uploads" -type f | wc -l | tr -d ' ')"
touch "$marque"
log "copie réussie : $(basename "$dump"), $pages pages, $medias médias en base, $fichiers fichiers sur le Mac"

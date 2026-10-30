#!/usr/bin/env bash
#
# verify.sh — lance tous les contrôles déclarés dans scripts/verify.conf.
#
# Ce script est générique : il ne connaît ni TypeScript, ni Vitest, ni aucun
# outil. Il lit la section [projet] de verify.conf et exécute ce qu'il y trouve.
# Le reprendre dans une autre application ne demande donc que d'y réécrire
# verify.conf.
#
# Volontairement sans « set -e » : un contrôle qui échoue ne doit pas priver
# des résultats des suivants. Le code de sortie final vaut 1 si au moins un
# contrôle a échoué.

set -uo pipefail

DOSSIER="$(cd "$(dirname "$0")" && pwd)"
CONF="$DOSSIER/verify.conf"

if [ ! -f "$CONF" ]; then
	echo "❌ Configuration introuvable : $CONF"
	exit 1
fi

# Rend les lignes utiles d'une section (ni vides, ni commentaires).
lire_section() {
	awk -v section="[$1]" '
		$0 == section { dedans = 1; next }
		/^\[/         { dedans = 0 }
		dedans && $0 !~ /^[[:space:]]*(#|$)/ { print }
	' "$CONF"
}

echec=0
lances=""

echo "════════════════════════════════════════════════════════"
echo " Vérifications du projet"
echo "════════════════════════════════════════════════════════"

while IFS='|' read -r nom commande; do
	[ -z "${commande:-}" ] && continue
	echo ""
	echo "▶ $nom"
	echo "  ($commande)"
	if eval "$commande"; then
		echo "✅ $nom"
	else
		echo "❌ $nom"
		echec=1
	fi
	lances="$lances $nom "
done < <(lire_section projet)

# Signale les contrôles usuels qui ne sont pas déclarés, pour qu'une absence
# reste visible au lieu de passer pour une réussite.
manquants=""
for attendu in types lint tests; do
	case "$lances" in
	*" $attendu "*) ;;
	*) manquants="$manquants $attendu" ;;
	esac
done

echo ""
echo "════════════════════════════════════════════════════════"
if [ -n "$manquants" ]; then
	echo "⚠️  Non configuré dans scripts/verify.conf :$manquants"
fi
if [ "$echec" -eq 0 ]; then
	echo "✅ Tous les contrôles configurés sont au vert."
else
	echo "❌ Au moins un contrôle a échoué (détail ci-dessus)."
fi
echo "════════════════════════════════════════════════════════"

exit "$echec"

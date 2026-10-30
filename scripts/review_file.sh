#!/usr/bin/env bash
#
# review_file.sh — rapport factuel sur UN fichier, sans aucune IA.
#
# Ce script est générique : il ne connaît aucun outil et lit tout ce qu'il
# doit lancer dans scripts/verify.conf, sections [fichier] et [test].
# Le reprendre dans une autre application ne demande donc que d'y réécrire
# verify.conf.
#
# Usage : npm run review:file -- <chemin/du/fichier>

set -uo pipefail

DOSSIER="$(cd "$(dirname "$0")" && pwd)"
CONF="$DOSSIER/verify.conf"
FICHIER="${1:-}"

if [ -z "$FICHIER" ]; then
	echo "❌ Usage : npm run review:file -- <chemin/du/fichier>"
	exit 1
fi
if [ ! -f "$FICHIER" ]; then
	echo "❌ Fichier introuvable : $FICHIER"
	exit 1
fi
if [ ! -f "$CONF" ]; then
	echo "❌ Configuration introuvable : $CONF"
	exit 1
fi

lire_section() {
	awk -v section="[$1]" '
		$0 == section { dedans = 1; next }
		/^\[/         { dedans = 0 }
		dedans && $0 !~ /^[[:space:]]*(#|$)/ { print }
	' "$CONF"
}

REPERTOIRE="$(dirname "$FICHIER")"
BASE="$(basename "$FICHIER")"
BASE="${BASE%.*}"

echo "════════════════════════════════════════════════════════"
echo " Revue de $FICHIER"
echo "════════════════════════════════════════════════════════"

# --- 1. Recherche du test associé -------------------------------------------
TEST=""
while read -r motif; do
	candidat="${motif//\{dir\}/$REPERTOIRE}"
	candidat="${candidat//\{base\}/$BASE}"
	if [ -f "$candidat" ]; then
		TEST="$candidat"
		break
	fi
done < <(lire_section test)

echo ""
if [ -n "$TEST" ]; then
	echo "🔎 Test associé : $TEST"
else
	echo "⚠️  Aucun test associé trouvé pour ce fichier."
	echo "   (ce n'est pas un échec, mais c'est le premier manque à combler)"
fi

# --- 2. Contrôles déclarés ---------------------------------------------------
echec=0
while IFS='|' read -r nom commande; do
	[ -z "${commande:-}" ] && continue
	if [[ "$commande" == *"{test}"* ]] && [ -z "$TEST" ]; then
		echo ""
		echo "⏭️  $nom : sauté, aucun test associé"
		continue
	fi
	commande="${commande//\{fichier\}/$FICHIER}"
	commande="${commande//\{test\}/$TEST}"
	echo ""
	echo "▶ $nom"
	if eval "$commande"; then
		echo "✅ $nom"
	else
		echo "❌ $nom"
		echec=1
	fi
done < <(lire_section fichier)

# --- 3. Mesures de taille et de complexité -----------------------------------
# Aucune dépendance : ces mesures marchent sur n'importe quel langage.
LIGNES=$(wc -l <"$FICHIER" | tr -d ' ')
EFFECTIVES=$(grep -cvE '^\s*(//|/\*|\*|#|$)' "$FICHIER")
FONCTIONS=$(grep -cE 'function |=>|^\s*def ' "$FICHIER")
BRANCHES=$(grep -cE '\b(if|else|for|while|case|catch|try)\b|&&|\|\|' "$FICHIER")
# Un niveau = une tabulation, ou deux espaces. Approximatif si le fichier est
# indenté sur quatre espaces : la profondeur affichée est alors doublée.
IMBRICATION=$(awk '
	{
		prefixe = $0
		sub(/[^ \t].*$/, "", prefixe)
		tabulations = gsub(/\t/, "", prefixe)
		niveau = tabulations + int(length(prefixe) / 2)
		if (niveau > max) max = niveau
	}
	END { print max + 0 }
' "$FICHIER")

echo ""
echo "📐 Taille et complexité"
echo "   Lignes                : $LIGNES"
echo "   Lignes de code        : $EFFECTIVES   (au-delà de 300, envisager un découpage)"
echo "   Fonctions             : $FONCTIONS"
echo "   Branches (si, sinon…) : $BRANCHES"
echo "   Imbrication maximale  : $IMBRICATION   (au-delà de 4, le code devient dur à suivre)"

echo ""
echo "════════════════════════════════════════════════════════"
if [ "$echec" -eq 0 ]; then
	echo "✅ Aucun contrôle en échec sur ce fichier."
else
	echo "❌ Au moins un contrôle a échoué (détail ci-dessus)."
fi
echo "════════════════════════════════════════════════════════"

exit "$echec"

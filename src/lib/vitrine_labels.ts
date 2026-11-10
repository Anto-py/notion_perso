// Vitrine de veille (étape 20), correction orthographique des étiquettes de
// Domaine (PLAN, étape 12) : partie pure. Le script `vitrine_etiquettes.mts`
// applique le plan à la base de la vitrine ; ce module n'écrit rien.
//
// Seul le `name` d'une option change, jamais son `id` : les valeurs des
// entrées désignent les options par id et suivent donc le renommage. Le texte
// dérivé `values_text` est recalculé par le script.
import { fold, type SelectOption } from "./property_schema.ts";

export type LabelFix = { id: string; from: string; to: string };

// Les neuf libellés du §14 de docs/page_veille/BRAINSTORMING.md, retrouvés
// par leur forme pliée (sans accents ni casse) pour résister aux variantes de
// saisie. L'apostrophe typographique est acceptée comme la droite.
const CORRECTIONS: Record<string, string> = {
  fancais: "Français",
  evaluation: "Évaluation",
  differenciation: "Différenciation",
  "education aux medias": "Éducation aux médias",
  "quizz / exerciseurs": "Quiz / exerciseurs",
  "cours on line": "Cours en ligne",
  "feed back": "Feedback",
  "gpt's": "GPTs",
  "gpt’s": "GPTs",
  "micro learning": "Microlearning",
};

// Sigles : la majuscule initiale les abîmerait (« ia » donnerait « Ia »), on
// les rend en capitales quelle que soit la saisie.
const SIGLES: Record<string, string> = {
  ia: "IA",
  llm: "LLM",
  rag: "RAG",
  "3d": "3D",
};

// Majuscule au premier caractère, seulement s'il est une minuscule : un sigle
// déjà en capitales, un chiffre ou un symbole restent intacts.
function initialUppercase(label: string): string {
  const first = label.codePointAt(0);
  if (first === undefined) return label;
  const char = String.fromCodePoint(first);
  const upper = char.toUpperCase();
  return upper === char ? label : upper + label.slice(char.length);
}

export function correctLabel(name: string): string {
  const key = fold(name);
  return CORRECTIONS[key] ?? SIGLES[key] ?? initialUppercase(name);
}

// Corrections à faire, dans l'ordre des options. Une option déjà correcte
// n'y figure pas ; un second passage rend donc une liste vide.
export function planLabelFixes(options: readonly SelectOption[]): LabelFix[] {
  const fixes: LabelFix[] = [];
  for (const option of options) {
    const to = correctLabel(option.name);
    if (to !== option.name) fixes.push({ id: option.id, from: option.name, to });
  }
  return fixes;
}

// Nouvelle liste, les options inchangées gardant leur objet : ni id ni couleur
// ne bougent.
export function applyLabelFixes(options: readonly SelectOption[], fixes: readonly LabelFix[]): SelectOption[] {
  const byId = new Map(fixes.map((fix) => [fix.id, fix.to]));
  return options.map((option) => {
    const to = byId.get(option.id);
    return to === undefined ? option : { ...option, name: to };
  });
}

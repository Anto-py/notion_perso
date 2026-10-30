// Icône d'une page (BRAINSTORMING §1 bis). Module pur, partagé par le serveur
// (validation, vue publique) et le navigateur (affichage, sélecteur).
//
// La colonne pages.icon porte un emoji tel quel, ou "image:<nom stocké>" pour
// une image de la bibliothèque (table icon_images). Nulle, l'icône par défaut
// est décidée à l'affichage : rien n'est écrit en base, l'information « pas
// d'icône choisie » reste lisible.
import { fold } from "./properties";
import { ALLOWED_TYPES, formatSize, isStoredName } from "./upload_rules";

export const ICON_MAX_BYTES = 5 * 1024 * 1024;
export const ICON_NAME_MAX = 100;
export const EMOJI_MAX = 16;

const IMAGE_PREFIX = "image:";

export type Icon = { kind: "emoji"; emoji: string } | { kind: "image"; filename: string };

export function defaultEmoji(type?: string): string {
  return type === "database" ? "🗃️" : "📄";
}

// Une image d'icône est un média stocké, jamais un PDF.
export function isIconFile(filename: string): boolean {
  return isStoredName(filename) && !filename.endsWith(".pdf");
}

export function imageIcon(filename: string): string {
  return IMAGE_PREFIX + filename;
}

export function iconSrc(filename: string): string {
  return `/api/media/${filename}`;
}

// Valeur stockée → icône, ou null (aucune, ou forme inconnue).
export function parseIcon(value: string | null | undefined): Icon | null {
  if (!value) return null;
  if (value.startsWith(IMAGE_PREFIX)) {
    const filename = value.slice(IMAGE_PREFIX.length);
    return isIconFile(filename) ? { kind: "image", filename } : null;
  }
  return { kind: "emoji", emoji: value };
}

// Icône affichée : celle choisie, sinon le défaut du type.
export function resolveIcon(value: string | null | undefined, type?: string): Icon {
  return parseIcon(value) ?? { kind: "emoji", emoji: defaultEmoji(type) };
}

// Un emoji, même composé (drapeau, famille, teinte de peau), tient en
// 16 unités UTF-16 et ne contient ni espace ni lettre latine : cela suffit à
// écarter le texte libre et toute imitation du préfixe image:.
function isEmoji(value: string): boolean {
  return value.length > 0 && value.length <= EMOJI_MAX && !/[\sA-Za-z<>&"']/.test(value);
}

// Valeur reçue par PATCH /api/pages/[id]. Une image n'est admise qu'avec son
// nom de fichier, que l'appelant vérifie ensuite dans la bibliothèque.
export function checkIconValue(
  value: unknown,
): { ok: true; value: string | null; filename: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null, filename: null };
  if (typeof value !== "string") return { ok: false };
  const icon = parseIcon(value);
  if (icon?.kind === "image") return { ok: true, value, filename: icon.filename };
  if (value.startsWith(IMAGE_PREFIX) || !isEmoji(value)) return { ok: false };
  return { ok: true, value, filename: null };
}

// --- Téléversement d'une image d'icône --------------------------------------

export const ICON_TYPES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ALLOWED_TYPES).filter(([type]) => type.startsWith("image/")),
);

export type IconUploadCheck = { ok: true; ext: string } | { ok: false; status: 413 | 415; error: string };

export function checkIconUpload(file: { size: number; type: string }): IconUploadCheck {
  if (file.size > ICON_MAX_BYTES) {
    return { ok: false, status: 413, error: `Image trop lourde (${formatSize(file.size)}) : la limite d'une icône est de 5 Mo.` };
  }
  const ext = ICON_TYPES[file.type];
  if (!ext) return { ok: false, status: 415, error: "Format refusé : PNG, JPEG, GIF, WebP ou AVIF." };
  return { ok: true, ext };
}

// Nom proposé pour un fichier : son nom sans extension (« logo_edulab.png »
// donne « logo_edulab »). Une image collée s'appelle « image.png » : on ne
// propose rien plutôt qu'un nom qui ne dit rien.
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "");
  return base === "image" ? "" : (cleanIconName(base) ?? "");
}

// Nom donné à une image : espaces resserrés, 1 à 100 caractères.
export function cleanIconName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const clean = name.replace(/\s+/g, " ").trim().slice(0, ICON_NAME_MAX);
  return clean.length ? clean : null;
}

// Recherche dans la bibliothèque, sans casse ni accents.
export function matchesIconName(name: string, query: string): boolean {
  const wanted = fold(query.trim());
  return !wanted || fold(name).includes(wanted);
}

// --- Onglet du navigateur ---------------------------------------------------

// Un emoji devient un SVG en data: (aucun fichier à servir) ; une image est
// servie telle quelle.
export function faviconHref(value: string | null | undefined, type?: string): string {
  const icon = resolveIcon(value, type);
  if (icon.kind === "image") return iconSrc(icon.filename);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon.emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Préfixe texte, là où une image ne peut pas s'afficher (option d'un
// <select>) : l'emoji choisi ou le défaut, rien pour une image.
export function iconText(value: string | null | undefined, type?: string): string {
  const icon = resolveIcon(value, type);
  return icon.kind === "emoji" ? `${icon.emoji} ` : "";
}

// Bandeau d'une page (BRAINSTORMING §1 ter). Module pur, partagé par le
// serveur (validation, vue publique) et le navigateur (affichage, sélecteur).
//
// La colonne pages.cover porte "color:<teinte>" pour une couleur de la palette,
// ou "image:<nom stocké>" pour une image téléversée. Nulle, aucun bandeau n'est
// affiché. La position verticale du recadrage vit à part, dans
// pages.cover_position (0 en haut, 100 en bas), parce qu'une image recadrée par
// object-fit demande un centrage choisi et qu'un nombre n'a rien à faire dans
// une chaîne.
import { isIconFile } from "./icons";

const COLOR_PREFIX = "color:";
const IMAGE_PREFIX = "image:";

// Palette fermée : la charte refuse les couleurs en dur dans les composants,
// ces noms renvoient aux variables --cover-* de globals.css. L'ordre est celui
// de la grille du sélecteur.
export const COVER_COLORS = [
  "sable",
  "teal",
  "ardoise",
  "brique",
  "soleil",
  "olive",
  "lavande",
  "brume",
] as const;

export type CoverColor = (typeof COVER_COLORS)[number];

export type Cover = { kind: "color"; color: CoverColor } | { kind: "image"; filename: string };

export const COVER_POSITION_DEFAULT = 50;

function isCoverColor(value: string): value is CoverColor {
  return (COVER_COLORS as readonly string[]).includes(value);
}

export function colorCover(color: CoverColor): string {
  return COLOR_PREFIX + color;
}

export function imageCover(filename: string): string {
  return IMAGE_PREFIX + filename;
}

// Valeur stockée → bandeau, ou null (aucun, ou forme inconnue).
export function parseCover(value: string | null | undefined): Cover | null {
  if (!value) return null;
  if (value.startsWith(COLOR_PREFIX)) {
    const color = value.slice(COLOR_PREFIX.length);
    return isCoverColor(color) ? { kind: "color", color } : null;
  }
  if (value.startsWith(IMAGE_PREFIX)) {
    const filename = value.slice(IMAGE_PREFIX.length);
    return isIconFile(filename) ? { kind: "image", filename } : null;
  }
  return null;
}

// Position reçue ou stockée : un entier de 0 à 100, 50 par défaut. Une valeur
// illisible ne casse pas le rendu, elle retombe sur le centrage.
export function coverPosition(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return COVER_POSITION_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Valeur reçue par PATCH /api/pages/[id] ou par la route du bandeau. Une image
// n'est admise qu'avec son nom de fichier, que l'appelant vérifie ensuite
// comme média existant.
export function checkCoverValue(
  value: unknown,
): { ok: true; value: string | null; filename: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null, filename: null };
  if (typeof value !== "string") return { ok: false };
  const cover = parseCover(value);
  if (!cover) return { ok: false };
  return { ok: true, value, filename: cover.kind === "image" ? cover.filename : null };
}

// Position reçue par l'API : un nombre fini, ramené dans [0, 100].
export function checkCoverPosition(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return coverPosition(value);
}

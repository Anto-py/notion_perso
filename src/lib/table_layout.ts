// Largeurs d'un tableau en disposition fixe (dès qu'une colonne a une
// largeur réglée). Le navigateur sert d'abord les colonnes réglées et donne
// le reste aux autres, 0 px s'il ne reste rien : une colonne ajoutée après
// les réglages disparaissait (constaté le 2026-11-11). Chaque colonne reçoit
// donc une largeur, et le tableau prend la somme, quitte à défiler.
export const DEFAULT_COLUMN_WIDTH = 160;

export function fixedColumnWidths(
  ids: readonly string[],
  widths: Readonly<Record<string, number>>,
): { widths: number[]; total: number } {
  const out = ids.map((id) => widths[id] ?? DEFAULT_COLUMN_WIDTH);
  return { widths: out, total: out.reduce((sum, width) => sum + width, 0) };
}

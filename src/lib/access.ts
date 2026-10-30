// Seule décision d'accès à une page (SPECS.md, « Porte ouverte au partage
// différé »). Le jour du partage avec des collègues, seul ce corps change.
export type AccessMode = "read" | "write";

export function canAccess(
  user: { id: string } | null,
  page: { id: string },
  mode: AccessMode,
): boolean {
  // v1 : compte unique, tout utilisateur connecté a tous les droits, quels
  // que soient la page et le mode.
  void page;
  void mode;
  return user !== null;
}

// Nettoyage des médias (BRAINSTORMING §10) : ce qu'un balayage décide, sans
// base ni disque. Les requêtes sont dans media_cleanup_query.ts.
import { ALLOWED_TYPES } from "./upload_rules";

export const MEDIA_RETENTION_DAYS = 30;

// Un nom stocké tel qu'il apparaît dans un texte (corps JSON, URL /api/media/).
// Même syntaxe pour JavaScript et pour les expressions de PostgreSQL. Un motif
// trop large ne peut que garder un fichier par erreur : toute citation contient
// le nom exact, aucune n'échappe au motif.
export const STORED_NAME_IN_TEXT = `up_[A-Za-z0-9_-]{16}\\.(?:${Object.values(ALLOWED_TYPES).join("|")})`;

export function storedNamesIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(STORED_NAME_IN_TEXT, "g")) ?? [])];
}

export type MediaState = { id: string; filename: string; unusedSince: Date | null };

export type CleanupPlan = {
  // inutilisés depuis ce balayage : unused_since = maintenant
  mark: string[];
  // de nouveau cités : unused_since = nul
  unmark: string[];
  // inutilisés depuis plus de `days` jours : à effacer, après revérification
  remove: MediaState[];
};

export function planCleanup(
  rows: readonly MediaState[],
  used: ReadonlySet<string>,
  now: Date,
  days: number = MEDIA_RETENTION_DAYS,
): CleanupPlan {
  const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
  const plan: CleanupPlan = { mark: [], unmark: [], remove: [] };
  for (const row of rows) {
    if (used.has(row.filename)) {
      if (row.unusedSince) plan.unmark.push(row.id);
    } else if (!row.unusedSince) {
      plan.mark.push(row.id);
    } else if (row.unusedSince.getTime() <= limit) {
      plan.remove.push(row);
    }
  }
  return plan;
}

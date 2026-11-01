// Changer de version sur le Mac (SPECS.md, « Changer de version (Mac) ») : le
// lanceur construit et bascule (scripts/notion_lancer.sh), le serveur lit
// l'état dans versions/ et le montre dans Réglages › Version. Pur : ni disque
// ni processus, tout est fourni.

// Code de sortie du serveur qui demande au lanceur de lire versions/.demande,
// de basculer et de relancer (EX_TEMPFAIL de sysexits.h).
export const RESTART_EXIT_CODE = 75;

const COMMIT = /^[0-9a-f]{7,40}$/;

export function isCommit(value: unknown): value is string {
  return typeof value === "string" && COMMIT.test(value);
}

// Un commit court (NOTION_APP_COMMIT, essais) désigne le même qu'un long.
export function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.length <= b.length ? b.startsWith(a) : a.startsWith(b);
}

// versions/.preparation, écrit par `notion_lancer.sh --preparer` :
// « <commit> <pid> » pendant la construction, « <commit> echec » après un
// échec ; effacé au succès, que signale versions/<commit>/server.js.
export type PreparationMarker = { commit: string; pid: number } | { commit: string; failed: true };

export function parsePreparation(text: string | null): PreparationMarker | null {
  const [commit, second, ...rest] = text?.trim().split(/\s+/) ?? [];
  if (!isCommit(commit) || rest.length > 0) return null;
  if (second === "echec") return { commit, failed: true };
  if (second && /^[1-9]\d*$/.test(second)) return { commit, pid: Number(second) };
  return null;
}

export type PreparationState = "a_preparer" | "en_cours" | "prete" | "echec";

// Une construction dont le processus est mort sans écrire « echec » (app
// quittée pendant la préparation) a échoué elle aussi.
export function preparationState({
  commit,
  built,
  marker,
  alive,
}: {
  commit: string;
  built: boolean;
  marker: PreparationMarker | null;
  alive: boolean;
}): PreparationState {
  if (built) return "prete";
  if (!marker || !sameCommit(marker.commit, commit)) return "a_preparer";
  if ("failed" in marker) return "echec";
  return alive ? "en_cours" : "echec";
}

// Version de secours, celle qu'on a quittée à la dernière bascule
// (APP_FALLBACK_COMMIT et APP_FALLBACK_SCHEMA, posés par le lanceur). Schéma :
// date de la dernière migration, comme serverVersion().
export type Fallback = { commit: string; schema: number };

// Raison d'un « Revenir à la version de secours » inactif, null s'il est
// permis. Drizzle n'a pas de migration descendante : à schéma égal seulement.
export function fallbackProblem(fallback: Fallback | null, currentSchema: number, pinned: boolean): string | null {
  if (pinned) return "Déjà en version de secours : « Mettre à jour » rend la version déployée.";
  if (!fallback) return "Aucune version de secours : elle apparaît après une première mise à jour.";
  if (fallback.schema !== currentSchema) {
    return "Son schéma diffère de celui de la base locale, et une migration ne se défait pas.";
  }
  return null;
}

// versions/.demande, lue par le lanceur quand le serveur sort en 75.
export type VersionDemand = { kind: "maj"; commit: string } | { kind: "secours" };

export function formatDemand(demand: VersionDemand): string {
  return demand.kind === "maj" ? `maj ${demand.commit}\n` : "secours\n";
}

// Corps de POST /api/version.
export type VersionRequest =
  | { action: "preparer"; commit: string }
  | { action: "redemarrer"; commit: string }
  | { action: "secours" };

export function parseVersionRequest(body: unknown): VersionRequest | null {
  if (!body || typeof body !== "object") return null;
  const { action, commit } = body as Record<string, unknown>;
  if (action === "secours") return { action };
  if ((action === "preparer" || action === "redemarrer") && isCommit(commit)) return { action, commit };
  return null;
}

// Libellés de l'état de synchronisation (BRAINSTORMING §11, « UI, état de la
// synchronisation ») : une ligne, un ton. Pur : l'horloge et l'état du réseau
// sont fournis, rien n'est lu d'ici. Le même module sert la ligne du Mac et,
// sur l'app web, l'heure du dernier passage du Mac.
import type { BackupAlert } from "./backup_rules";
import type { DamageCounts, SyncSuspension } from "./settings_rules";

// Motif du dernier échec (SyncError de lib/sync_client.ts) : offline, serveur
// injoignable ; version, schéma ou code différent ; token, jeton refusé.
export type SyncReason = "offline" | "version" | "token" | "server";

export type SyncSnapshot = {
  syncedAt: Date | null;
  error: string | null;
  reason?: SyncReason | null;
  pending: number;
  conflicts: number;
  online: boolean;
  suspended?: SyncSuspension | null;
  backupAlert?: BackupAlert | null;
};

export type SyncTone = "calm" | "pending" | "offline" | "conflict" | "error" | "suspended" | "backup";

const BACKUP_TEXT: Record<BackupAlert, string> = {
  update_deferred: "⚠ Mise à jour reportée : sauvegarde impossible",
  daily_failed: "⚠ Sauvegarde du jour impossible",
};
export type SyncLine = { tone: SyncTone; text: string; title?: string };

// Avancement du cycle en cours, tel que le lit GET /api/synchro. Les totaux
// viennent du serveur au premier lot (lib/sync_server.ts) ; null tant qu'ils
// ne sont pas arrivés.
export type CycleProgress = {
  first: boolean;
  pages: number;
  pagesTotal: number | null;
  bytes: number;
  bytesTotal: number | null;
};

// Bruxelles, quel que soit le fuseau de la machine qui rend la ligne.
const CLOCK = new Intl.DateTimeFormat("fr-BE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Brussels",
});

export function formatClock(date: Date): string {
  return CLOCK.format(date);
}

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

// Octets lisibles, à la française : « 812 ko », « 80 Mo », « 1,2 Go ».
export function formatBytes(bytes: number): string {
  const units = ["o", "ko", "Mo", "Go", "To"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded).replace(".", ",")} ${units[unit]}`;
}

// « Première synchronisation : 640 pages sur 1668, médias 80 Mo sur 257 Mo ».
// Une reprise après absence n'annonce pas de total : le serveur ne le donne
// qu'à une synchronisation depuis zéro.
export function progressLabel(progress: CycleProgress): string {
  if (!progress.first) return "Synchronisation en cours…";
  if (progress.pagesTotal === null) return "Première synchronisation…";
  const pages = `${progress.pages} pages sur ${progress.pagesTotal}`;
  if (progress.bytesTotal === null) return `Première synchronisation : ${pages}`;
  return `Première synchronisation : ${pages}, médias ${formatBytes(progress.bytes)} sur ${formatBytes(progress.bytesTotal)}`;
}

// « 1638 pages purgées sur le serveur » : le nombre, le geste quand il est
// seul en cause, et le côté d'où venait le lot arrêté.
export function suspensionMotive(suspension: Extract<SyncSuspension, { by: "auto" }>): string {
  const { count, kinds, direction } = suspension;
  const many = count > 1;
  const verbs: Record<keyof DamageCounts, string> = {
    trashed: many ? "mises en corbeille" : "mise en corbeille",
    emptied: many ? "vidées" : "vidée",
    purged: many ? "purgées" : "purgée",
  };
  const only = (Object.keys(verbs) as (keyof DamageCounts)[]).filter((kind) => kinds[kind] > 0);
  const verb = only.length === 1 ? verbs[only[0]] : many ? "abîmées" : "abîmée";
  const side = direction === "down" ? "sur le serveur" : "sur le Mac";
  return `${count} ${plural(count, "page", "pages")} ${verb} ${side}`;
}

// Priorité : une suspension arrête tout échange (toute erreur affichée serait
// d'avant elle) ; une sauvegarde ratée est un risque qui dure, une erreur de
// synchronisation passe d'elle-même (choix d'Antonin du 2026-11-01) ; un
// conflit demande un geste, le hors ligne explique l'attente, le reste est du
// calme.
// Un écart de version se règle en relançant l'app, qui se met à jour au
// lancement (SPECS.md, « Versions ») : la ligne le dit plutôt que l'échec.
export function syncLine({ syncedAt, error, reason, pending, conflicts, online, suspended, backupAlert }: SyncSnapshot): SyncLine {
  if (suspended) {
    const title = "Reprendre dans Réglages › Synchronisation";
    if (suspended.by === "auto") return { tone: "suspended", text: `⏸ Suspendue : ${suspensionMotive(suspended)}`, title };
    return { tone: "suspended", text: `⏸ Synchronisation suspendue${pending > 0 ? ` · ${pending} en attente` : ""}`, title };
  }
  if (backupAlert) return { tone: "backup", text: BACKUP_TEXT[backupAlert], title: "Voir Réglages › Sauvegardes" };
  if (error && reason === "version") return { tone: "error", text: "⚠ Redémarrer pour mettre à jour", title: error };
  if (error) return { tone: "error", text: "⚠ Synchronisation en échec", title: error };
  if (conflicts > 0) {
    return { tone: "conflict", text: `⚠ ${conflicts} ${plural(conflicts, "conflit", "conflits")}` };
  }
  if (!online) {
    return { tone: "offline", text: pending > 0 ? `⌁ Hors ligne · ${pending} en attente` : "⌁ Hors ligne" };
  }
  if (pending > 0) {
    return {
      tone: "pending",
      text: `↻ ${pending} ${plural(pending, "modification en attente", "modifications en attente")}`,
    };
  }
  if (syncedAt) return { tone: "calm", text: `✓ Synchronisé ${formatClock(syncedAt)}` };
  return { tone: "pending", text: "↻ Pas encore synchronisé" };
}

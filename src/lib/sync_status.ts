// Libellés de l'état de synchronisation (BRAINSTORMING §11, « UI, état de la
// synchronisation ») : une ligne, un ton. Pur : l'horloge et l'état du réseau
// sont fournis, rien n'est lu d'ici. Le même module sert la ligne du Mac et,
// sur l'app web, l'heure du dernier passage du Mac.

export type SyncSnapshot = {
  syncedAt: Date | null;
  error: string | null;
  pending: number;
  conflicts: number;
  online: boolean;
};

export type SyncTone = "calm" | "pending" | "offline" | "conflict" | "error";
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

// Priorité : une erreur empêche tout, un conflit demande un geste, le hors
// ligne explique l'attente, le reste est du calme.
export function syncLine({ syncedAt, error, pending, conflicts, online }: SyncSnapshot): SyncLine {
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

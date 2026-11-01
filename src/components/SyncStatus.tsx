"use client";
// État de la synchronisation côté Mac (BRAINSTORMING §11) : la ligne du bas
// de la barre latérale, son bouton, et le drapeau « cette page attend » que
// lit l'indicateur d'enregistrement. Un seul fournisseur pour toute l'app :
// la sidebar et la page ouverte ne peuvent pas diverger.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { BackupAlert } from "@/lib/backup_rules";
import type { SyncSuspension } from "@/lib/settings_rules";
import { progressLabel, syncLine, type CycleProgress, type SyncReason } from "@/lib/sync_status";

type Status = {
  // null tant que le premier GET n'a pas répondu ; false sur une instance qui
  // ne se synchronise pas (VPS, développement), qui n'affiche rien.
  configured: boolean | null;
  syncedAt: string | null;
  error: string | null;
  reason: SyncReason | null;
  pending: number;
  conflicts: number;
  progress: CycleProgress | null;
  suspended: SyncSuspension | null;
  backupAlert: BackupAlert | null;
  trialFailed: boolean;
  fallback: boolean;
};

type Value = Status & {
  online: boolean;
  syncing: boolean;
  version: number;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
};

const EMPTY: Status = {
  configured: null,
  syncedAt: null,
  error: null,
  reason: null,
  pending: 0,
  conflicts: 0,
  progress: null,
  suspended: null,
  backupAlert: null,
  trialFailed: false,
  fallback: false,
};
const REFRESH_MS = 10_000;

const SyncContext = createContext<Value | null>(null);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(EMPTY);
  // Lu au premier rendu plutôt que posé dans un effet : le fournisseur ne
  // rend rien de visible avant le premier GET, aucun écart d'hydratation.
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  // Incrémenté à chaque état relu : l'indicateur de page s'en sert pour
  // redemander si sa page attend encore.
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/synchro", { cache: "no-store" }).catch(() => null);
    // Réseau coupé : l'état garde sa dernière valeur, navigator.onLine fait foi.
    if (!response) return;
    if (response.status === 404) {
      setStatus({ ...EMPTY, configured: false });
      return;
    }
    if (!response.ok) return;
    const data = (await response.json().catch(() => null)) as Omit<Status, "configured"> | null;
    if (!data) return;
    setStatus({ configured: true, ...data });
    setVersion((n) => n + 1);
  }, []);

  // Le POST rend 404 sur une instance qui ne se synchronise pas, sans effet :
  // seul le retour du réseau d'un tel serveur peut l'appeler.
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/synchro", { method: "POST" }).catch(() => null);
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    // Différé d'un tour : la règle react-hooks/set-state-in-effect refuse un
    // setState synchrone dans le corps de l'effet, même via une promesse.
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    // Retour du réseau : un cycle tout de suite (BRAINSTORMING §11, rythme).
    const goOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh, syncNow]);

  return (
    <SyncContext.Provider value={{ ...status, online, syncing, version, syncNow, refresh }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncStatus(): Value {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSyncStatus hors de SyncStatusProvider");
  return value;
}

// Cette page attend-elle d'être envoyée ? null : on ne sait pas (instance
// sans synchronisation, ou premier GET en cours). savedTick : compteur de
// l'autosauvegarde, pour redemander juste après un enregistrement.
export function usePagePending(pageId: string, savedTick: number): boolean | null {
  const { configured, version } = useSyncStatus();
  // La page est retenue avec la réponse : un changement de page ne montre
  // jamais l'état de la précédente pendant le nouvel aller-retour.
  const [known, setKnown] = useState<{ pageId: string; pending: boolean } | null>(null);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    fetch(`/api/synchro?page=${encodeURIComponent(pageId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { pagePending?: boolean } | null) => {
        if (live && typeof data?.pagePending === "boolean") setKnown({ pageId, pending: data.pagePending });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [configured, pageId, version, savedTick]);

  return configured && known?.pageId === pageId ? known.pending : null;
}

// La ligne d'état telle que la calcule syncLine, pour la barre latérale et
// Réglages › Synchronisation.
export function useSyncLine() {
  const { syncedAt, error, reason, pending, conflicts, online, suspended, backupAlert, trialFailed, fallback } = useSyncStatus();
  return syncLine({
    syncedAt: syncedAt ? new Date(syncedAt) : null,
    error,
    reason,
    pending,
    conflicts,
    online,
    suspended,
    backupAlert,
    trialFailed,
    fallback,
  });
}

// Où mène un clic sur la ligne : un conflit vers sa liste, une suspension
// vers ce qui la lève, une sauvegarde ratée vers la liste des sauvegardes,
// la version de secours vers « Mettre à jour ».
const LINE_LINKS: Partial<Record<string, string>> = {
  conflict: "/conflits",
  suspended: "/reglages#synchronisation",
  backup: "/reglages#sauvegardes",
  fallback: "/reglages#version",
};

// Ligne d'état et bouton, en bas de la barre latérale. Rien sur une
// instance qui ne se synchronise pas.
export function SyncStatus() {
  const { configured, progress, online, syncing, syncNow, suspended } = useSyncStatus();
  const line = useSyncLine();
  if (!configured) return null;
  const busy = syncing || progress !== null;
  const href = LINE_LINKS[line.tone];
  return (
    <div className={`sync-status sync-${line.tone}`}>
      {href ? (
        <Link href={href} title={line.title}>
          {line.text}
        </Link>
      ) : (
        <span title={line.title}>{line.text}</span>
      )}
      {progress && <p className="sync-progress">{progressLabel(progress)}</p>}
      <button
        type="button"
        className="sync-now"
        onClick={() => void syncNow()}
        disabled={!online || busy || suspended !== null}
        title={
          suspended
            ? "Synchronisation suspendue : reprendre dans Réglages › Synchronisation"
            : !online
            ? "Serveur injoignable : synchronisation impossible hors ligne"
            : busy
              ? "Synchronisation en cours"
              : "Lancer une synchronisation maintenant"
        }
      >
        {busy ? "Synchronisation…" : "Synchroniser maintenant"}
      </button>
    </div>
  );
}

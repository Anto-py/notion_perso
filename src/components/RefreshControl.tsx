"use client";
// Version en ligne : relit l'état du serveur sans recharger la page, pour
// voir ce que le Mac (ou un autre appareil) a envoyé entre-temps. Sur
// l'instance Mac, la synchronisation a son propre bouton (SyncStatus) : ce
// contrôle s'efface quand elle est configurée.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { refreshOpenContent } from "./refresh_request";
import { useSyncStatus } from "./SyncStatus";

export function RefreshControl() {
  const router = useRouter();
  const { configured } = useSyncStatus();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Le premier GET de /api/synchro répond parfois avant que la barre latérale
  // streamée ne s'hydrate ; sans ce tour, le bouton naîtrait pendant
  // l'hydratation (avertissement « Hydration failed »). null avant la réponse.
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  if (!ready || configured !== false) return null;

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      // Attendre l'enregistrement de ce qui attend, puis relire la page
      // ouverte ; router.refresh() refait ensuite arbre, bases et compteurs.
      await refreshOpenContent();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Actualisation impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-status">
      <button
        type="button"
        className="sync-now"
        onClick={() => void refresh()}
        disabled={busy}
        title="Relire l'état du serveur : modifications faites sur le Mac ou un autre appareil"
      >
        {busy ? "Actualisation…" : "Actualiser"}
      </button>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

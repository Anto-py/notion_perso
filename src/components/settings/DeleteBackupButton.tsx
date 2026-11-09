// Réglages › Sauvegardes › « Effacer » : deux clics, comme la corbeille, pour
// qu'une sauvegarde ne parte jamais sur un clic de trop.
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteBackupButton({ name }: { name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/sauvegardes/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    if (!response?.ok) {
      setError(body?.error ?? "Effacement impossible");
      setBusy(false);
      setConfirming(false);
      return;
    }
    router.refresh();
    setBusy(false);
    setConfirming(false);
  }

  return (
    <span className="backup-delete">
      {confirming ? (
        <>
          <button type="button" onClick={remove} disabled={busy}>
            {busy ? "Effacement…" : "Confirmer"}
          </button>
          <button type="button" className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Annuler
          </button>
        </>
      ) : (
        <button type="button" className="ghost" onClick={() => setConfirming(true)} disabled={busy}>
          Effacer
        </button>
      )}
      {error && <span className="hint"> {error}</span>}
    </span>
  );
}

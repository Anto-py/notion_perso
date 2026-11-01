// Réglages › Sauvegardes › « Vérifier maintenant » (palier e) : restaure les
// dumps dans une base jetable. Une restauration prend des dizaines de secondes.
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TrialButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trial() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/sauvegardes/essai", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response?.ok) {
      setError(body?.error ?? "Vérification impossible");
      return;
    }
    router.refresh();
  }

  return (
    <span className="backup-open">
      <button type="button" onClick={trial} disabled={busy}>
        {busy ? "Vérification…" : "Vérifier maintenant"}
      </button>
      {error && <span className="hint"> {error}</span>}
    </span>
  );
}

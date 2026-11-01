// Réglages › Sauvegardes › « Ouvrir » (palier d) : la restauration dure des
// dizaines de secondes, le bouton le dit et l'erreur s'affiche sur place.
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OpenBackupButton({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/sauvegarde", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    if (!response?.ok) {
      setError(body?.error ?? "Ouverture impossible");
      setBusy(false);
      return;
    }
    router.push("/sauvegarde");
  }

  return (
    <span className="backup-open">
      <button type="button" onClick={open} disabled={busy}>
        {busy ? "Ouverture…" : "Ouvrir"}
      </button>
      {error && <span className="hint"> {error}</span>}
    </span>
  );
}

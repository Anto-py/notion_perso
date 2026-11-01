// « Récupérer » depuis une page de la sauvegarde (BRAINSTORMING §12) : la page
// seule, ou tout son contenu d'un geste. La version actuelle part en corbeille
// comme copie, rien ne se perd.
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Recovered = { pageId: string; recovered: number; trashedCopies: number; missingFiles: number };

export function RecoverButton({ id, kind, descendants }: { id: string; kind: "page" | "database" | "entry"; descendants: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"page" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Recovered | null>(null);

  async function recover(subtree: boolean) {
    setBusy(subtree ? "all" : "page");
    setError(null);
    const response = await fetch("/api/sauvegarde/recuperer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, subtree }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as (Recovered & { error?: string }) | null;
    if (!response?.ok || !body) {
      setError(body?.error ?? "Récupération impossible");
      setBusy(null);
      return;
    }
    setDone(body);
    setBusy(null);
    router.refresh();
  }

  if (done) {
    return (
      <div className="backup-recovered" role="status">
        <p>
          {done.recovered === 1 ? "Page récupérée" : `${done.recovered} pages récupérées`}.
          {done.trashedCopies > 0 &&
            ` La version qui était là part en corbeille (${done.trashedCopies} ${done.trashedCopies > 1 ? "copies" : "copie"}).`}
          {done.missingFiles > 0 && ` ${done.missingFiles} fichier(s) introuvable(s).`}
        </p>
        <Link href={kind === "database" ? `/db/${done.pageId}` : `/page/${done.pageId}`}>Voir dans l&apos;app</Link>
      </div>
    );
  }

  const many =
    kind === "database"
      ? `${descendants} ${descendants > 1 ? "entrées" : "entrée"}`
      : `${descendants} ${descendants > 1 ? "sous-pages" : "sous-page"}`;
  return (
    <div className="backup-recover">
      <button type="button" onClick={() => recover(false)} disabled={busy !== null}>
        {busy === "page" ? "Récupération…" : "Récupérer cette page"}
      </button>
      {descendants > 0 && (
        <button type="button" onClick={() => recover(true)} disabled={busy !== null}>
          {busy === "all" ? "Récupération…" : `Récupérer avec ${many}`}
        </button>
      )}
      {error && <p className="hint">{error}</p>}
    </div>
  );
}

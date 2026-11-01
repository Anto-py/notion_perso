// Bandeau de l'écran de sauvegarde (BRAINSTORMING §12) : dit ce qu'on
// regarde et permet de fermer, ce qui dépose la copie et ramène à Réglages.
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Fuseau fixé : le rendu serveur et l'hydratation donnent la même heure.
const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function BackupBanner({ at }: { at: Date }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function close() {
    setBusy(true);
    // Une fermeture qui échoue laisse quand même quitter la lecture : le
    // prochain « Ouvrir » repart d'un dump neuf.
    await fetch("/api/sauvegarde", { method: "DELETE" }).catch(() => undefined);
    router.push("/reglages#sauvegardes");
  }

  return (
    <div className="backup-banner" role="status">
      <span>
        Sauvegarde du {DATE.format(at)} · lecture seule, rien ne s&apos;y modifie
      </span>
      <button type="button" className="backup-close" onClick={close} disabled={busy}>
        {busy ? "Fermeture…" : "Fermer"}
      </button>
    </div>
  );
}

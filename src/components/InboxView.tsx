"use client";
// Vide-cerveau : un champ unique, une capture par bloc en bas de la page. La
// capture part au serveur ; le compteur est relu par router.refresh(), comme
// celui de la barre latérale.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "./request";

export function InboxView({ inbox, count }: { inbox: { id: string; title: string }; count: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    if (!text.trim()) return;
    setError(null);
    setBusy(true);
    const result = await send("/api/inbox", "POST", { text });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <main className="page page-wide inbox">
      <div className="page-bar">
        <span className="hint">{count === 0 ? "Rien à traiter" : `${count} à traiter`}</span>
        <Link href={`/page/${inbox.id}`} className="hint">
          Ouvrir la page
        </Link>
      </div>
      <h1 className="inbox-heading">{inbox.title}</h1>

      <form
        className="capture-card"
        onSubmit={(event) => {
          event.preventDefault();
          void capture();
        }}
      >
        <textarea
          aria-label="Chose à capturer"
          placeholder="Une idée, un lien, une chose à ne pas oublier…"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl (ou Cmd) + Entrée capture sans quitter le clavier.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void capture();
            }
          }}
        />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {busy ? "Capture…" : "Capturer"}
        </button>
      </form>

      <p className="hint capture-hint">Ctrl + Entrée capture. Une adresse seule devient une mention.</p>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

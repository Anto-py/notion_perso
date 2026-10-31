"use client";
// Liste de la corbeille : restaurer, ou supprimer définitivement en deux
// clics (le second confirme, sans boîte de dialogue du navigateur), un
// élément ou toute la corbeille. `total` compte aussi les sous-pages et
// entrées parties avec chaque élément.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageLabel } from "./PageIcon";

type Item = { id: string; title: string; icon: string | null; trashedAt: string };

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });

const ALL = "tout";

export function TrashList({ items, total }: { items: Item[]; total: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(id: string, method: "POST" | "DELETE") {
    setMessage(null);
    setConfirming(null);
    const response = await (id === ALL
      ? fetch("/api/trash?tout=1", { method: "DELETE" })
      : fetch("/api/trash", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
    ).catch(() => null);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "Connexion perdue : action non effectuée.");
      return;
    }
    router.refresh();
  }

  if (items.length === 0) return <p>La corbeille est vide.</p>;

  return (
    <>
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      <div className="trash-empty">
        {confirming === ALL ? (
          <>
            <button type="button" className="danger" onClick={() => act(ALL, "DELETE")}>
              Supprimer définitivement {total} {total > 1 ? "pages" : "page"}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </button>
          </>
        ) : (
          <button type="button" className="ghost" onClick={() => setConfirming(ALL)}>
            Vider la corbeille
          </button>
        )}
      </div>
      <ul className="trash-list">
        {items.map((item) => (
          <li key={item.id}>
            <span className="trash-title"><PageLabel row={item} /></span>
            <span className="trash-date">supprimé le {DATE.format(new Date(item.trashedAt))}</span>
            <span className="trash-actions">
              <button type="button" onClick={() => act(item.id, "POST")}>
                Restaurer
              </button>
              {confirming === item.id ? (
                <>
                  <button type="button" className="danger" onClick={() => act(item.id, "DELETE")}>
                    Confirmer la suppression définitive
                  </button>
                  <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                    Annuler
                  </button>
                </>
              ) : (
                <button type="button" className="ghost" onClick={() => setConfirming(item.id)}>
                  Supprimer définitivement
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

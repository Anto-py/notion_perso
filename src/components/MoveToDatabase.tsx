"use client";
// Envoi d'une entrée vers une autre base : un bouton, un choix, un envoi.
// Utilisé par le panneau d'une entrée et par la liste du Vide-cerveau. Les
// valeurs sans propriété d'accueil partent dans le corps, côté serveur.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "./request";

type Props = {
  entryId: string;
  databases: { id: string; title: string; icon: string | null }[];
  label?: string;
  // Dans une carte de liste, le menu s'ouvre au-dessus du contenu voisin au
  // lieu de pousser la mise en page.
  popover?: boolean;
  onMoved?: () => void;
};

export function MoveToDatabase({ entryId, databases, label = "Déplacer vers une autre base…", popover = false, onMoved }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (databases.length === 0) return null;

  async function move() {
    if (!target) return;
    setBusy(true);
    const result = await send(`/api/entries/${entryId}/move`, "POST", { dbId: target });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setTarget("");
    onMoved?.();
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="ghost move-trigger" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className={popover ? "move-entry popover" : "move-entry"} role="group" aria-label="Déplacer vers une base">
      <label className="hint" htmlFor={`move-${entryId}`}>
        Déplacer vers
      </label>
      <select id={`move-${entryId}`} value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Choisir une base…</option>
        {databases.map((database) => (
          <option key={database.id} value={database.id}>
            {database.icon ? `${database.icon} ` : ""}
            {database.title || "Sans titre"}
          </option>
        ))}
      </select>
      <button type="button" onClick={move} disabled={!target || busy}>
        {busy ? "Envoi…" : "Envoyer"}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setOpen(false);
          setTarget("");
          setError(null);
        }}
      >
        Annuler
      </button>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

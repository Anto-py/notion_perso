"use client";
// Dossier sous la racine des bases (étapes 16 et 17, BRAINSTORMING §14 et §15) :
// ni corps ni propriétés ; il liste ses dossiers puis ses bases, et en crée. La
// racine elle-même est une page : elle s'ouvre dans l'éditeur, pas ici.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FolderItem } from "@/lib/pages";
import { CommitInput } from "./CommitInput";
import { IconPicker } from "./IconPicker";
import { PageLabel } from "./PageIcon";
import { send } from "./request";
import { useTabMeta } from "./tabs_store";

export type Crumb = { id: string; title: string; icon: string | null; type: string };

// Fil « Bases de données / Cours / Séquences » au-dessus du titre d'une base ou
// d'un dossier : chaque élément ouvre sa page.
export function BasesCrumbs({ trail }: { trail: Crumb[] }) {
  if (!trail.length) return null;
  return (
    <nav className="bases-crumbs" aria-label="Chemin dans « Bases de données »">
      {trail.map((crumb, index) => (
        <span key={crumb.id}>
          {index > 0 && " / "}
          <Link href={`/page/${crumb.id}`}>{crumb.title || "Sans titre"}</Link>
        </span>
      ))}
    </nav>
  );
}

type Props = {
  folder: { id: string; title: string; icon: string | null };
  trail: Crumb[];
  items: FolderItem[];
  // Bases emportées par une mise à la corbeille, toute profondeur.
  basesInside: number;
};

export function FolderView({ folder, trail, items, basesInside }: Props) {
  const router = useRouter();
  useTabMeta(`/page/${folder.id}`, folder.title, folder.icon, "folder");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function create(type: "database" | "folder") {
    setMessage(null);
    const result = await send("/api/pages", "POST", { parentId: folder.id, type });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.refresh();
    if (type === "database") router.push(`/db/${String(result.data.id)}`);
  }

  async function rename(title: string) {
    const result = await send(`/api/pages/${folder.id}`, "PATCH", { title });
    if (!result.ok) setMessage(result.error);
    else router.refresh();
  }

  async function moveToTrash() {
    const result = await send(`/api/pages/${folder.id}`, "DELETE");
    if (!result.ok) {
      setConfirming(false);
      setMessage(result.error);
      return;
    }
    router.push(trail.length ? `/page/${trail[trail.length - 1].id}` : "/");
    router.refresh();
  }

  return (
    <main className="page">
      <div className="page-bar">
        <button type="button" className="ghost" onClick={() => (basesInside > 0 ? setConfirming(true) : void moveToTrash())}>
          Supprimer le dossier
        </button>
      </div>
      {confirming && (
        <div className="confirm-bar" role="alert">
          <span>
            Ce dossier emporte {basesInside} {basesInside > 1 ? "bases" : "base"} à la corbeille ; la restauration rendra l’ensemble.
          </span>
          <button type="button" className="danger" onClick={() => void moveToTrash()}>
            Confirmer
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Annuler
          </button>
        </div>
      )}
      <BasesCrumbs trail={trail} />
      <IconPicker pageId={folder.id} type="folder" initial={folder.icon} />
      <CommitInput
        key={folder.title}
        className="page-title folder-title-input"
        aria-label="Nom du dossier"
        placeholder="Sans titre"
        value={folder.title}
        onCommit={(title) => void rename(title)}
      />
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      <div className="folder-actions">
        <button type="button" onClick={() => void create("database")}>
          + Base
        </button>
        <button type="button" onClick={() => void create("folder")}>
          + Dossier
        </button>
      </div>
      {items.length === 0 ? (
        <p className="hint">Dossier vide.</p>
      ) : (
        <ul className="folder-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.inbox ? "/inbox" : item.type === "database" ? `/db/${item.id}` : `/page/${item.id}`}>
                <PageLabel row={item} />
              </Link>
              {item.type === "database" && (
                <span className="folder-count">
                  {item.entries} {item.entries > 1 ? "entrées" : "entrée"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

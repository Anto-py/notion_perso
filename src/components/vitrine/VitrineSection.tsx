"use client";
// Section « Vitrine » du panneau « Partager » d'une base (BRAINSTORMING de la
// vitrine, §10) : publier la vitrine /veille, copier son adresse, choisir ou
// retirer la page d'accueil. Indépendante de la publication /p/… de la base.
import { useEffect, useRef, useState } from "react";
import type { TreeRow } from "@/lib/tree";
import { CopyUrlButton } from "../CopyUrlButton";
import { PagePicker } from "../PagePicker";
import { send } from "../request";

type Named = { id: string; title: string };
type State = {
  enabled: boolean;
  welcomePageId: string | null;
  welcomeTitle: string | null;
  welcomeMissing: boolean;
  activeElsewhere: Named | null;
  url: string;
};

function parseState(data: Record<string, unknown>): State {
  const other = data.activeElsewhere as Named | null | undefined;
  return {
    enabled: data.enabled === true,
    welcomePageId: typeof data.welcomePageId === "string" ? data.welcomePageId : null,
    welcomeTitle: typeof data.welcomeTitle === "string" ? data.welcomeTitle : null,
    welcomeMissing: data.welcomeMissing === true,
    activeElsewhere: other && typeof other.id === "string" ? other : null,
    url: typeof data.url === "string" ? data.url : "/veille",
  };
}

// Une page d'accueil est une page : ni base, ni dossier, ni Vide-cerveau.
const isWelcomeCandidate = (row: TreeRow) => row.type === "page" && !row.inbox;

export function VitrineSection({ baseId }: { baseId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [directory, setDirectory] = useState<ReadonlyMap<string, TreeRow> | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await fetch(`/api/vitrine/${baseId}`, { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? ((await response.json().catch(() => null)) as Record<string, unknown> | null) : null;
      if (!live) return;
      if (data) setState(parseState(data));
      else setMessage("Lecture de la vitrine impossible : réessayez.");
    })();
    return () => {
      live = false;
    };
  }, [baseId]);

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const result = await send(`/api/vitrine/${baseId}`, "PUT", body);
    if (!result.ok) setMessage(result.error);
    else setState(parseState(result.data));
    setBusy(false);
  }

  // L'arbre se lit à la demande : sur /db/[id], l'annuaire des pages du
  // navigateur est vide (piège recensé dans AGENTS.md).
  async function choose() {
    setMessage(null);
    if (!directory) {
      const response = await fetch("/api/pages", { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? ((await response.json().catch(() => null)) as { pages?: TreeRow[] } | null) : null;
      if (!data?.pages) {
        setMessage("Lecture des pages impossible : réessayez.");
        return;
      }
      setDirectory(new Map(data.pages.map((row) => [row.id, row])));
    }
    setAnchor(chooseRef.current);
  }

  // Composée dans le navigateur, comme le lien /p/… : le serveur ne connaît
  // pas toujours son domaine. Sur le Mac, l'adresse distante arrive entière.
  const url = state ? (state.url.startsWith("/") ? `${window.location.origin}${state.url}` : state.url) : "";

  return (
    <div className="share-opens share-vitrine">
      <p className="share-opens-title">Vitrine de veille</p>
      {!state ? (
        <p className="hint">{message ?? "Lecture…"}</p>
      ) : (
        <>
          <label className="share-switch">
            <input
              type="checkbox"
              role="switch"
              checked={state.enabled}
              disabled={busy}
              onChange={(event) => put({ enabled: event.target.checked })}
            />
            Publier la vitrine
          </label>
          {state.enabled ? (
            <p className="share-vitrine-address">
              <code>{url}</code>
              <CopyUrlButton url={url} />
            </p>
          ) : (
            <p className="hint">
              {state.activeElsewhere
                ? `La vitrine montre déjà « ${state.activeElsewhere.title || "Sans titre"} ».`
                : "Une page de consultation publique de cette base, sans compte, à l'adresse /veille."}
            </p>
          )}
          <div className="share-vitrine-welcome">
            <span className="share-opens-label">
              <span className="share-opens-path">Page d&apos;accueil</span>
              <span className="share-opens-name">
                {state.welcomeMissing ? "Page introuvable" : state.welcomeTitle !== null ? state.welcomeTitle || "Sans titre" : "Aucune"}
              </span>
            </span>
            <span className="share-vitrine-actions">
              <button ref={chooseRef} type="button" className="ghost" disabled={busy} onClick={() => void choose()}>
                Choisir
              </button>
              {state.welcomePageId && (
                <button type="button" className="ghost" disabled={busy} onClick={() => put({ welcomePageId: null })}>
                  Retirer
                </button>
              )}
            </span>
          </div>
          {message && (
            <p className="status" role="status">
              {message}
            </p>
          )}
        </>
      )}
      {anchor && directory && (
        <PagePicker
          anchor={anchor}
          pages={directory}
          hostId={baseId}
          accept={isWelcomeCandidate}
          label="Chercher la page d'accueil"
          onPick={(row) => {
            setAnchor(null);
            void put({ welcomePageId: row.id });
          }}
          onCancel={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

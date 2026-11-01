"use client";
// Écran de partage : ce que le téléphone envoie, prérempli, une destination
// (le Vide-cerveau par défaut) et un bouton. L'enregistrement passe par la
// capture du Vide-cerveau puis, si une autre base est choisie, par le
// déplacement d'entrée : les valeurs sans accueil y gagnent le corps de la page.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { iconText } from "@/lib/icons";
import type { SharedPayload } from "@/lib/share";
import { domainOf } from "@/lib/unfurl";
import { SiteIcon } from "./InboxView";
import { send } from "./request";

type Database = { id: string; title: string; icon: string | null };
type Saved = { id: string; where: string; warning?: string };

export function ShareCapture({
  payload,
  inbox,
  databases,
}: {
  payload: Exclude<SharedPayload, { kind: "empty" }>;
  inbox: { id: string; title: string };
  databases: Database[];
}) {
  const link = payload.kind === "link" ? payload : null;
  const [title, setTitle] = useState(link?.title ?? "");
  // Une ref et non un état : l'effet qui lit l'aperçu doit voir la valeur du
  // moment où la réponse arrive, pas celle, figée, du montage.
  const touched = useRef(false);
  const [text, setText] = useState(payload.kind === "note" ? payload.text : "");
  const [preview, setPreview] = useState({ description: "", source: "", image: "" as string });
  const [loading, setLoading] = useState(link !== null);
  const [target, setTarget] = useState(inbox.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  // L'aperçu se lit après l'affichage : l'écran sert tout de suite, avec
  // « chargement du titre… », et un échec laisse le titre reçu ou le domaine.
  const url = link?.url ?? null;
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data: { title?: string; description?: string; site?: string; image?: string | null } | null) => {
        if (!alive) return;
        setLoading(false);
        if (!data) return;
        setPreview({ description: data.description ?? "", source: data.site ?? "", image: data.image ?? "" });
        // Le titre lu sur la page l'emporte sur celui du partage, jamais sur
        // celui que l'utilisateur a déjà retouché.
        const pageTitle = data.title;
        if (pageTitle && !touched.current) setTitle(pageTitle);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const destinations = [{ id: inbox.id, title: inbox.title, icon: "📥" }, ...databases];
  const targetName = destinations.find((database) => database.id === target)?.title || "Sans titre";

  async function save() {
    setError(null);
    setBusy(true);
    const body = link
      ? { url: link.url, title: title.trim() || domainOf(link.url), description: preview.description, source: preview.source, image: preview.image || null }
      : { text };
    const captured = await send("/api/inbox", "POST", body);
    if (!captured.ok) {
      setBusy(false);
      setError(captured.error);
      return;
    }
    const id = String(captured.data.id);
    if (target === inbox.id) {
      setBusy(false);
      setSaved({ id, where: inbox.title });
      return;
    }
    const moved = await send(`/api/entries/${id}/move`, "POST", { dbId: target });
    setBusy(false);
    setSaved(
      moved.ok
        ? { id, where: targetName }
        : { id, where: inbox.title, warning: `Le déplacement vers « ${targetName} » a échoué : ${moved.error}` },
    );
  }

  if (saved) {
    return (
      <div className="share-done" role="status">
        <p className="share-done-title">Enregistré dans « {saved.where} ».</p>
        {saved.warning && <p className="status status-error">{saved.warning}</p>}
        <div className="share-links">
          <Link href={`/page/${saved.id}`}>Ouvrir l&apos;entrée</Link>
          <Link href="/inbox">Aller au Vide-cerveau</Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="share-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save();
      }}
    >
      {link ? (
        <div className="share-mention">
          <span className="inbox-icon" aria-hidden="true">
            <SiteIcon url={link.url} />
          </span>
          <div className="inbox-body">
            <div className="inbox-line">
              {preview.source && <span className="inbox-source">{preview.source}</span>}
              <span className="inbox-url">{domainOf(link.url)}</span>
            </div>
            <label className="share-field">
              <span className="control-label">Titre</span>
              <input
                value={title}
                placeholder={loading ? "Chargement du titre…" : domainOf(link.url)}
                onChange={(event) => {
                  touched.current = true;
                  setTitle(event.target.value);
                }}
              />
            </label>
            {loading ? (
              <p className="hint">Chargement du titre…</p>
            ) : (
              preview.description && <p className="inbox-preview">{preview.description}</p>
            )}
          </div>
        </div>
      ) : (
        <label className="share-field">
          <span className="control-label">Note</span>
          <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      )}

      <label className="share-field">
        <span className="control-label">Destination</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {destinations.map((database) => (
            <option key={database.id} value={database.id}>
              {iconText(database.icon, "database")}
              {database.title || "Sans titre"}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary share-submit" disabled={busy || (!link && !text.trim())}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}

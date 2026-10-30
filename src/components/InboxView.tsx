"use client";
// Vide-cerveau : deux captures (texte libre, lien) et la liste des entrées à
// traiter. La capture part au serveur, qui lit l'aperçu d'un lien ; la liste
// est relue par router.refresh(), comme le compteur de la sidebar.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InboxRow } from "@/lib/inbox";
import { domainOf, faviconUrl } from "@/lib/unfurl";
import { MoveToDatabase } from "./MoveToDatabase";
import { send } from "./request";

const dateFormat = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function InboxView({
  inbox,
  rows,
  databases,
}: {
  inbox: { id: string; title: string };
  rows: InboxRow[];
  databases: { id: string; title: string; icon: string | null }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"note" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function capture(kind: "note" | "link") {
    setError(null);
    setBusy(kind);
    const result = await send("/api/inbox", "POST", kind === "note" ? { text } : { url });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (kind === "note") setText("");
    else setUrl("");
    router.refresh();
  }

  return (
    <main className="page page-wide inbox">
      <div className="page-bar">
        <span className="hint">{rows.length === 0 ? "Rien à traiter" : `${rows.length} à traiter`}</span>
        <Link href={`/db/${inbox.id}`} className="hint">
          Ouvrir comme base
        </Link>
      </div>
      <h1 className="inbox-heading">{inbox.title}</h1>

      <form
        className="capture-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void capture("note");
        }}
      >
        <textarea
          aria-label="Idée à capturer"
          placeholder="Une idée, une chose à ne pas oublier…"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl (ou Cmd) + Entrée capture sans quitter le clavier.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (text.trim()) void capture("note");
            }
          }}
        />
        <button type="submit" disabled={busy !== null || !text.trim()}>
          {busy === "note" ? "Capture…" : "Capturer"}
        </button>
      </form>

      <form
        className="capture-card capture-link"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) void capture("link");
        }}
      >
        <input
          type="url"
          aria-label="Lien à capturer"
          placeholder="https://…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit" disabled={busy !== null || !url.trim()}>
          {busy === "link" ? "Lecture de la page…" : "Ajouter le lien"}
        </button>
      </form>

      <p className="hint capture-hint">Ctrl + Entrée capture la note. Un lien garde son titre et son aperçu, ou son seul domaine si la page les cache.</p>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="inbox-empty">Le Vide-cerveau est vide. Ce qui entre ici attend d&apos;être trié vers une base.</p>
      ) : (
        <ul className="inbox-list">
          {rows.map((row) => {
            const url = row.kind === "link" ? row.url : null;
            return (
              <li key={row.id} className={url ? "inbox-item is-link" : "inbox-item is-note"}>
                {/* La nature est portée par l'icône ; un lecteur d'écran ne
                    l'entend pas, d'où ce texte masqué. */}
                <span className="sr-only">{url ? "Lien" : "Note"}</span>
                <span className="inbox-icon" aria-hidden="true">
                  {url ? <SiteIcon url={url} /> : "📝"}
                </span>
                <div className="inbox-body">
                  <div className="inbox-line">
                    {row.source && <span className="inbox-source">{row.source}</span>}
                    <Link href={`/page/${row.id}`} className="inbox-title">
                      {row.title || "Sans titre"}
                    </Link>
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="inbox-url">
                      {domainOf(url)}
                    </a>
                  )}
                  {row.preview && <p className="inbox-preview">{row.preview}</p>}
                </div>
                <div className="inbox-side">
                  <time className="inbox-date" dateTime={row.createdAt}>
                    {dateFormat.format(new Date(row.createdAt))}
                  </time>
                  <MoveToDatabase entryId={row.id} databases={databases} label="Déplacer" popover />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

// Favicon servi par le site, avec repli sur un globe. Beaucoup de pages n'en
// publient pas à /favicon.ico, et une réponse 200 peut contenir du HTML : un
// échec de décodage déclenche aussi onError. L'état évite de relancer la
// requête à chaque rendu.
function SiteIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  if (!src || failed) return <span className="inbox-glyph">🌐</span>;
  return (
    // L'hôte est arbitraire : next/image exigerait de déclarer chaque domaine,
    // et son optimisation n'a rien à gagner sur une icône de 16 px.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="inbox-favicon" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} />
  );
}

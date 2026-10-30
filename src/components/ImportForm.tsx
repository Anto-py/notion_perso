"use client";
// Formulaire d'import Notion : dépôt du zip, progression d'envoi, rapport.
// Le rapport vient de /api/import ; la barre ne mesure que l'envoi, le serveur
// lisant et écrivant ensuite sans événement intermédiaire.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Note = { reason: string; count: number };

export type ImportReport = {
  rootId: string;
  rootTitle: string;
  counts: { pages: number; databases: number; entries: number; media: number };
  ignored: Note[];
  notes: Note[];
};

type Reply = Partial<ImportReport> & { error?: string };

function NoteList({ title, items }: { title: string; items: Note[] }) {
  if (items.length === 0) return null;
  return (
    <section className="import-detail">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.reason}>
            {item.reason}
            {item.count > 1 && <span className="import-count"> × {item.count}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImportForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  function choose(next: File | null) {
    setReport(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      setError("Déposez l'archive zip produite par Notion.");
      return;
    }
    setError(null);
    setFile(next);
  }

  function send() {
    if (!file || busy) return;
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    setError(null);
    setReport(null);
    setProgress(0);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/import");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setBusy(false);
      setProgress(null);
      let reply: Reply | null = null;
      try {
        reply = JSON.parse(request.responseText) as Reply;
      } catch {
        reply = null;
      }
      if (request.status >= 200 && request.status < 300 && reply?.rootId) {
        setReport(reply as ImportReport);
        setFile(null);
        if (input.current) input.current.value = "";
        router.refresh();
      } else {
        setError(reply?.error ?? "Import impossible.");
      }
    };
    request.onerror = () => {
      setBusy(false);
      setProgress(null);
      setError("Connexion perdue pendant l'import.");
    };
    request.send(body);
  }

  return (
    <div className="import">
      <label
        className={dragging ? "import-drop over" : "import-drop"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files[0] ?? null);
        }}
      >
        <input
          ref={input}
          className="import-file"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
        <span className="import-drop-title">{file ? file.name : "Déposez l'archive zip"}</span>
        <span className="import-drop-hint">
          {file ? "Cliquez pour choisir une autre archive." : "Ou cliquez pour choisir un fichier."}
        </span>
      </label>

      {progress !== null && (
        <div className="import-progress">
          <progress value={progress} max={100} />
          <span>
            {progress < 100 ? `Envoi… ${progress} %` : "Le serveur lit l'archive et écrit les pages…"}
          </span>
        </div>
      )}

      <div className="import-actions">
        <button type="button" className="btn-primary import-submit" onClick={send} disabled={!file || busy}>
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </div>

      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <section className="import-report" aria-live="polite">
          <h2>Import terminé</h2>
          <dl className="import-counts">
            <div>
              <dt>Pages</dt>
              <dd>{report.counts.pages}</dd>
            </div>
            <div>
              <dt>Bases</dt>
              <dd>{report.counts.databases}</dd>
            </div>
            <div>
              <dt>Entrées</dt>
              <dd>{report.counts.entries}</dd>
            </div>
            <div>
              <dt>Médias</dt>
              <dd>{report.counts.media}</dd>
            </div>
          </dl>
          <p className="import-open">
            <Link href={`/page/${report.rootId}`}>Ouvrir « {report.rootTitle} »</Link>
          </p>
          <NoteList title="Conversions" items={report.notes} />
          <NoteList title="Laissé de côté" items={report.ignored} />
        </section>
      )}
    </div>
  );
}

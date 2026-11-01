"use client";
// Réglages › Synchronisation (Mac) : l'état tel que le dit la ligne de la barre
// latérale, le serveur distant, « Suspendre » et « Reprendre », le motif d'une
// suspension automatique et son seuil (BRAINSTORMING §12). L'état vient du
// même fournisseur que la ligne d'état : les deux ne divergent jamais.
import { useState, type FormEvent } from "react";
import { useSyncLine, useSyncStatus } from "../SyncStatus";
import { send } from "../request";

type Props = { remote: string; threshold: number; thresholdDefault: number };

const DATE = new Intl.DateTimeFormat("fr-BE", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Brussels",
});

export function SyncSection({
  remote,
  threshold: initialThreshold,
  thresholdDefault,
}: Props) {
  const { suspended, syncedAt, refresh } = useSyncStatus();
  const line = useSyncLine();
  const [threshold, setThreshold] = useState(String(initialThreshold));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  async function toggle(suspend: boolean) {
    setBusy(true);
    setMessage(null);
    const result = await send("/api/synchro/suspension", "POST", { suspend });
    await refresh();
    setBusy(false);
    if (!result.ok) setMessage({ error: true, text: result.error });
  }

  async function saveThreshold(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const result = await send("/api/reglages", "PATCH", {
      key: "sync.threshold",
      value: threshold,
    });
    if (!result.ok) {
      setMessage({ error: true, text: result.error });
      return;
    }
    const saved =
      typeof result.data.value === "number"
        ? result.data.value
        : thresholdDefault;
    setThreshold(String(saved));
    setMessage({ error: false, text: `Seuil enregistré : ${saved} pages.` });
  }

  return (
    <section id="synchronisation" className="settings-section">
      <h2>Synchronisation</h2>
      <dl className="settings-facts">
        <dt>État</dt>
        <dd className={`sync-${line.tone}`}>{line.text}</dd>
        <dt>Dernier échange réussi</dt>
        <dd>{syncedAt ? DATE.format(new Date(syncedAt)) : "aucun"}</dd>
        <dt>Serveur</dt>
        <dd>
          <code>{remote}</code>
        </dd>
      </dl>

      {suspended?.by === "auto" && (
        <div className="settings-alert" role="status">
          <p>
            Un échange{" "}
            {suspended.direction === "down"
              ? "venu du serveur"
              : "parti du Mac"}{" "}
            aurait touché {suspended.count} pages, plus que le seuil : rien
            n&apos;a été{" "}
            {suspended.direction === "down" ? "écrit sur le Mac" : "envoyé"}. Le{" "}
            {DATE.format(new Date(suspended.at))}, parmi elles :
          </p>
          <ul>
            {suspended.titles.map((title, index) => (
              <li key={index}>{title || "Sans titre"}</li>
            ))}
          </ul>
          <p className="hint">
            « Reprendre » applique ce lot tel quel. Pour le refuser, gardez la
            suspension et ouvrez une sauvegarde.
          </p>
        </div>
      )}

      <div className="settings-actions">
        <p className="hint">
          Suspendue, l&apos;app enregistre toujours ici et n&apos;échange plus
          rien avec le serveur, même après un redémarrage.
        </p>
        {suspended ? (
          <button
            type="button"
            className="settings-submit"
            disabled={busy}
            onClick={() => void toggle(false)}
          >
            {busy ? "Reprise…" : "Reprendre"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle(true)}
          >
            {busy ? "Suspension…" : "Suspendre"}
          </button>
        )}
      </div>

      <form className="settings-form" onSubmit={saveThreshold}>
        <label className="share-field">
          <span>
            Suspendre d&apos;office un échange qui toucherait plus de … pages
            (corbeille, corps vidé, purge)
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={threshold}
            placeholder={String(thresholdDefault)}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </label>
        <button type="submit">Enregistrer le seuil</button>
      </form>
      {message && (
        <p
          className={message.error ? "status status-error" : "status"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

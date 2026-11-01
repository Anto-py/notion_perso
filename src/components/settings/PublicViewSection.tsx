"use client";
// Réglages › Vue publique (app web) : nom du site et lien LinkedIn des pages
// publiées, appliqués dès l'enregistrement. Un champ vidé rend la main aux
// variables SITE_NAME et LINKEDIN_URL.
import { useState, type FormEvent } from "react";
import { send } from "../request";

type Props = { siteName: string; linkedinUrl: string; fallbackSiteName: string };

export function PublicViewSection({ siteName: initialName, linkedinUrl: initialUrl, fallbackSiteName }: Props) {
  const [siteName, setSiteName] = useState(initialName);
  const [linkedinUrl, setLinkedinUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    // L'un après l'autre : un refus du second laisse le premier enregistré,
    // et le message dit lequel a échoué.
    for (const [key, value, label] of [
      ["public.site_name", siteName, "Nom du site"],
      ["public.linkedin_url", linkedinUrl, "Lien LinkedIn"],
    ] as const) {
      const result = await send("/api/reglages", "PATCH", { key, value });
      if (!result.ok) {
        setBusy(false);
        setMessage({ error: true, text: `${label} : ${result.error}` });
        return;
      }
      const saved = typeof result.data.value === "string" ? result.data.value : "";
      if (key === "public.site_name") setSiteName(saved);
      else setLinkedinUrl(saved);
    }
    setBusy(false);
    setMessage({ error: false, text: "Enregistré : les pages publiées l'affichent dès maintenant." });
  }

  return (
    <section id="vue-publique" className="settings-section">
      <h2>Vue publique</h2>
      <form className="settings-form" onSubmit={submit}>
        <label className="share-field">
          <span>Nom du site, en tête des pages publiées</span>
          <input value={siteName} placeholder={fallbackSiteName} maxLength={80} onChange={(event) => setSiteName(event.target.value)} />
        </label>
        <label className="share-field">
          <span>Lien LinkedIn, en pied de page</span>
          <input
            type="url"
            value={linkedinUrl}
            placeholder="https://www.linkedin.com/in/…"
            onChange={(event) => setLinkedinUrl(event.target.value)}
          />
        </label>
        {message && (
          <p className={message.error ? "status status-error" : "status"} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        )}
        <button type="submit" className="settings-submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
    </section>
  );
}

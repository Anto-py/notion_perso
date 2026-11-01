"use client";
// Réglages › Compte : changer le mot de passe (l'actuel, puis le nouveau deux
// fois), se déconnecter. Les autres sessions sont fermées par le serveur.
import { useState, type FormEvent } from "react";
import { send } from "../request";
import { PASSWORD_MIN, newPasswordProblem } from "@/lib/settings_rules";

export function AccountSection({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = newPasswordProblem(current, next) ?? (next !== confirm ? "Les deux saisies du nouveau mot de passe diffèrent" : null);
    if (problem) {
      setMessage({ error: true, text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await send("/api/account/password", "POST", { current, next });
    setBusy(false);
    if (!result.ok) {
      setMessage({ error: true, text: result.error });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage({ error: false, text: "Mot de passe changé. Les autres sessions sont fermées." });
  }

  return (
    <section id="compte" className="settings-section">
      <h2>Compte</h2>
      <form className="settings-form" onSubmit={submit}>
        {/* Nom d'utilisateur caché : le gestionnaire de mots de passe sait
            à quel compte rattacher le nouveau. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <label className="share-field">
          <span>Mot de passe actuel</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="share-field">
          <span>Nouveau mot de passe ({PASSWORD_MIN} caractères au moins)</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label className="share-field">
          <span>Nouveau mot de passe, une seconde fois</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        {message && (
          <p className={message.error ? "status status-error" : "status"} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        )}
        <button type="submit" className="settings-submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Changer le mot de passe"}
        </button>
      </form>
      <form method="post" action="/api/auth/logout" className="settings-logout">
        <span>Connecté en tant que {username}.</span>{" "}
        <button type="submit" className="link">
          Se déconnecter
        </button>
      </form>
    </section>
  );
}

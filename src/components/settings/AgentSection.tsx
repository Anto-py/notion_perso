"use client";
// Réglages › Agent (app web, BRAINSTORMING §17) : jetons d'agent, créés ici,
// révocables au second clic ; le jeton en clair ne s'affiche qu'une fois,
// avec la commande qui le range au trousseau. Puis les demandes en attente.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestActionLabel, type RequestAction } from "@/lib/agent_rules";
import { CopyUrlButton } from "../CopyUrlButton";
import { send } from "../request";

type Token = { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
// warnings : ce qu'un déplacement ferait au public, lu à l'affichage.
type Request = {
  id: string;
  action: RequestAction;
  pageId: string;
  pageTitle: string | null;
  targetId: string | null;
  targetTitle: string | null;
  warnings: string[];
  tokenName: string | null;
  model: string | null;
  createdAt: string;
};

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });
const SERVICE = "notion-perso-agent";

function keychainCommand(token: string): string {
  return `security add-generic-password -U -a np -s ${SERVICE} -w '${token}'`;
}

export function AgentSection({ tokens, requests }: { tokens: Token[]; requests: Request[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await send("/api/acces_agent", "POST", { name });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setCreated({ name: String(result.data.name), token: String(result.data.token) });
    setName("");
    router.refresh();
  }

  async function revoke(id: string) {
    setConfirming(null);
    setMessage(null);
    const result = await send(`/api/acces_agent/${encodeURIComponent(id)}`, "DELETE");
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  async function decide(id: string, decision: "accepted" | "refused") {
    setDeciding(id);
    setMessage(null);
    const result = await send(`/api/acces_agent/requests/${encodeURIComponent(id)}`, "POST", { decision });
    setDeciding(null);
    if (!result.ok) setMessage(result.error);
    // Le geste a pu s'exécuter avant de fermer la demande : relire dans tous
    // les cas.
    router.refresh();
  }

  return (
    <section id="agent" className="settings-section">
      <h2>Agent</h2>
      <p className="hint">
        Les jetons qui permettent au harnais (commande <code>np</code>) de lire et d&apos;écrire ici. Un jeton par usage ;
        révoquer coupe son accès dès son prochain appel.
      </p>
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}

      <form className="settings-form" onSubmit={create}>
        <label className="share-field">
          <span>Nom du nouveau jeton</span>
          <input value={name} placeholder="Harnais Mac" maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="settings-submit" disabled={busy || name.trim() === ""}>
          Créer un jeton
        </button>
      </form>

      {created && (
        <div className="agent-created" role="status">
          <p>
            Jeton « {created.name} » créé. <strong>Il ne sera plus affiché</strong> : range-le au trousseau maintenant.
          </p>
          <p className="settings-copy">
            <code>{created.token}</code> <CopyUrlButton url={created.token} />
          </p>
          <p className="hint">Commande pour le trousseau macOS :</p>
          <p className="settings-copy">
            <code>{keychainCommand(created.token)}</code> <CopyUrlButton url={keychainCommand(created.token)} />
          </p>
          <button type="button" className="ghost" onClick={() => setCreated(null)}>
            C&apos;est rangé
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p>Aucun jeton.</p>
      ) : (
        <ul className="settings-list">
          {tokens.map((token) => (
            <li key={token.id}>
              <span className="settings-list-name">{token.name}</span>
              <span className="hint">
                {token.revokedAt
                  ? `révoqué le ${DATE.format(new Date(token.revokedAt))}`
                  : token.lastUsedAt
                    ? `dernier usage le ${DATE.format(new Date(token.lastUsedAt))}`
                    : "jamais utilisé"}
              </span>
              {!token.revokedAt && (
                <span className="settings-list-actions">
                  {confirming === token.id ? (
                    <>
                      <button type="button" className="danger" onClick={() => revoke(token.id)}>
                        Révoquer « {token.name} »
                      </button>
                      <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirming(token.id)}>
                      Révoquer
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Demandes en attente</h3>
      <p className="hint">
        Publication, suppression définitive et déplacement qui change ce que le public lit passent par ici : l&apos;agent
        dépose la demande, rien n&apos;est fait avant votre décision.
      </p>
      {requests.length === 0 ? (
        <p>Aucune demande.</p>
      ) : (
        <ul className="settings-list agent-requests">
          {requests.map((demand) => (
            <li key={demand.id}>
              <span className="settings-list-name">{requestActionLabel(demand.action)}</span>
              <span>
                {demand.pageTitle ?? demand.pageId}
                {demand.action === "move" &&
                  (demand.targetId ? ` → sous « ${demand.targetTitle ?? demand.targetId} »` : " → à la racine")}
              </span>
              <span className="hint">
                {demand.tokenName ?? "jeton supprimé"}
                {demand.model ? ` · ${demand.model}` : ""} · {DATE.format(new Date(demand.createdAt))}
              </span>
              <span className="settings-list-actions">
                <button type="button" disabled={deciding === demand.id} onClick={() => decide(demand.id, "accepted")}>
                  Valider
                </button>
                <button type="button" className="ghost" disabled={deciding === demand.id} onClick={() => decide(demand.id, "refused")}>
                  Refuser
                </button>
              </span>
              {demand.warnings.length > 0 && (
                <ul className="agent-request-warnings">
                  {demand.warnings.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

    </section>
  );
}

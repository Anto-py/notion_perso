"use client";
// Réglages › Appareils (app web) : les clients de synchronisation, révocables
// au second clic, qui nomme l'appareil (pas de boîte de dialogue du navigateur).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "../request";

type Client = { id: string; name: string; lastSeenAt: string | null };

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });

export function DevicesSection({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke(id: string) {
    setConfirming(null);
    setMessage(null);
    const result = await send(`/api/appareils/${encodeURIComponent(id)}`, "DELETE");
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section id="appareils" className="settings-section">
      <h2>Appareils</h2>
      <p className="hint">Les apps Mac qui se synchronisent avec ce serveur. Révoquer coupe leur accès dès leur prochain échange.</p>
      {message && (
        <p className="status status-error" role="alert">
          {message}
        </p>
      )}
      {clients.length === 0 ? (
        <p>Aucun appareil.</p>
      ) : (
        <ul className="settings-list">
          {clients.map((client) => (
            <li key={client.id}>
              <span className="settings-list-name">{client.name}</span>
              <span className="hint">
                {client.lastSeenAt ? `dernier passage le ${DATE.format(new Date(client.lastSeenAt))}` : "jamais vu"}
              </span>
              <span className="settings-list-actions">
                {confirming === client.id ? (
                  <>
                    <button type="button" className="danger" onClick={() => revoke(client.id)}>
                      Révoquer « {client.name} »
                    </button>
                    <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(client.id)}>
                    Révoquer
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

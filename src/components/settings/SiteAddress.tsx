"use client";
// Réglages › Adresse du site : l'adresse web de l'installation, avec le bouton
// « Copier » de la vue publique. Sur le Mac, l'adresse vient du site distant
// (`SYNC_REMOTE_URL`), jamais de localhost ; sur l'instance web, c'est l'origine
// de la page, lue comme une source externe pour éviter tout écart d'hydratation.
import { useSyncExternalStore } from "react";
import { CopyUrlButton } from "../CopyUrlButton";

// L'origine ne change pas pendant la vie de la page : aucun abonnement.
const subscribe = () => () => {};
const originNow = () => window.location.origin;
const originOnServer = () => "";

export function SiteAddress({ webAddress }: { webAddress: string }) {
  const origin = useSyncExternalStore(subscribe, originNow, originOnServer);
  const address = webAddress || origin;

  return (
    <section id="adresse" className="settings-section">
      <h2>Adresse du site</h2>
      <p className="settings-address">
        <code>{address || "…"}</code>
        {address && (
          <span className="settings-copy">
            <CopyUrlButton url={address} />
          </span>
        )}
      </p>
      <p className="hint">L’adresse web de cette installation, prête à être copiée.</p>
    </section>
  );
}

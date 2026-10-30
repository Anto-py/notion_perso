"use client";
// Branche la mécanique de lib/saver.ts sur une page : envoi par PATCH,
// envoi immédiat quand l'onglet se masque ou qu'on quitte la page,
// avertissement du navigateur si on ferme l'onglet avant l'envoi.
import { useEffect, useState } from "react";
import { createSaver, type Patch, type SaveStatus } from "@/lib/saver";

// Plafond du navigateur pour une requête keepalive (celle qui survit à la
// fermeture de l'onglet) : 64 Ko, marge comprise.
const KEEPALIVE_MAX = 60_000;

async function sendPatch(pageId: string, patch: Patch, leaving: boolean): Promise<void> {
  const body = JSON.stringify(patch);
  let response: Response;
  try {
    response = await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: leaving && body.length < KEEPALIVE_MAX,
    });
  } catch {
    throw new Error("Connexion perdue : modifications non enregistrées.");
  }
  if (response.status === 401) throw new Error("Session expirée : reconnectez-vous.");
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Enregistrement refusé (${response.status}).`);
  }
}

// pageId et onSaved sont lus une fois, à la création : PageView est recréé
// (key) à chaque changement de page, et onSaved ne s'appuie que sur le
// routeur, stable.
export function useAutosave(pageId: string, onSaved: (patch: Patch) => void) {
  const [status, setStatus] = useState<SaveStatus>({ state: "saved" });
  const [saver] = useState(() =>
    createSaver({
      send: (patch, leaving) => sendPatch(pageId, patch, leaving),
      onStatus: setStatus,
      onSaved,
    }),
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void saver.flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void saver.flush(true);
    };
  }, [saver]);

  useEffect(() => {
    if (status.state === "saved") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.state]);

  return { status, queue: saver.queue, cancel: saver.cancel };
}

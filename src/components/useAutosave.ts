"use client";
// Branche la mécanique de lib/saver.ts sur une page : envoi par PATCH,
// envoi immédiat quand l'onglet se masque ou qu'on quitte la page,
// avertissement du navigateur si on ferme l'onglet avant l'envoi.
//
// Contrôle de version (lib/web_save.ts) : le hook garde la dernière version
// que le serveur a confirmée (révision, titre, corps). Chaque envoi porte
// cette révision ; si la page a bougé ailleurs, le serveur répond 409 et
// l'envoi repart avec la base, que le serveur fusionne. Au retour sur
// l'onglet, rien n'attendant d'être enregistré, une page changée ailleurs est
// relue.
import { useEffect, useState } from "react";
import { createSaver, type Patch, type SaveStatus } from "@/lib/saver";
import { sameJson } from "@/lib/sync_merge";
import type { WebFields } from "@/lib/web_save";

// Plafond du navigateur pour une requête keepalive (celle qui survit à la
// fermeture de l'onglet) : 64 Ko, marge comprise.
const KEEPALIVE_MAX = 60_000;

type Confirmed = { rev: number; title: string; body: unknown[] };

// La page telle que GET /api/pages/[id] la rend, pour ce que l'écran affiche.
export type RemotePage = Confirmed & { icon: string | null; cover: string | null; coverPosition: number | null };

type Options = {
  initial: Confirmed;
  // Un lot vient d'être enregistré.
  onSaved: (patch: Patch) => void;
  // Le serveur a fusionné : sent est ce qui était parti, merged ce qui s'est écrit.
  onMerged?: (sent: Patch, merged: WebFields) => void;
  // Au retour sur l'onglet, la page avait changé ailleurs.
  onRemote?: (page: RemotePage) => void;
};

async function request(pageId: string, payload: Record<string, unknown>, leaving: boolean): Promise<Response> {
  const body = JSON.stringify(payload);
  try {
    return await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: leaving && body.length < KEEPALIVE_MAX,
    });
  } catch {
    throw new Error("Connexion perdue : modifications non enregistrées.");
  }
}

async function sendPatch(
  pageId: string,
  patch: Patch,
  leaving: boolean,
  confirmed: { current: Confirmed },
  onMerged: Options["onMerged"],
): Promise<void> {
  const known = confirmed.current;
  // Rien n'est envoyé de ce que le serveur a déjà : une version fusionnée
  // posée dans l'éditeur ne repart pas.
  const fields: Patch = {};
  if (patch.title !== undefined && patch.title !== known.title) fields.title = patch.title;
  if (patch.body !== undefined && !sameJson(patch.body, known.body)) fields.body = patch.body;
  if (fields.title === undefined && fields.body === undefined) return;
  const base: WebFields = {};
  if (fields.title !== undefined) base.title = known.title;
  if (fields.body !== undefined) base.body = known.body;

  // En quittant la page, pas de second essai possible : la base part tout de
  // suite, si la requête tient encore dans le plafond keepalive.
  const payload: Record<string, unknown> = { ...fields, baseRev: known.rev };
  const withBase = { ...payload, base };
  const first = leaving && JSON.stringify(withBase).length < KEEPALIVE_MAX ? withBase : payload;
  let response = await request(pageId, first, leaving);
  if (response.status === 409 && first === payload) response = await request(pageId, withBase, leaving);

  if (response.status === 401) throw new Error("Session expirée : reconnectez-vous.");
  const data = (await response.json().catch(() => null)) as { error?: string; rev?: number; merged?: WebFields } | null;
  if (!response.ok || typeof data?.rev !== "number") {
    throw new Error(data?.error ?? `Enregistrement refusé (${response.status}).`);
  }
  const merged = data.merged;
  confirmed.current = {
    rev: data.rev,
    title: merged?.title ?? fields.title ?? known.title,
    body: merged?.body ?? fields.body ?? known.body,
  };
  if (merged?.body !== undefined && !sameJson(merged.body, fields.body)) onMerged?.(fields, merged);
}

// pageId et les options sont lus une fois, à la création : PageView est
// recréé (key) à chaque changement de page, et les rappels ne s'appuient que
// sur des refs et sur le routeur, stables.
export function useAutosave(pageId: string, { initial, onSaved, onMerged, onRemote }: Options) {
  const [status, setStatus] = useState<SaveStatus>({ state: "saved" });
  // Compteur des lots enregistrés : l'indicateur de synchronisation s'en sert
  // pour redemander si la page attend encore (deux « saved » de suite ne
  // changeraient pas status.state, donc pas de dépendance possible dessus).
  const [savedCount, setSavedCount] = useState(0);
  // Supports mutables plutôt que des refs : la mécanique d'envoi, créée une
  // fois, les lit hors du rendu.
  const [lastStatus] = useState(() => ({ current: status }));
  const [confirmed] = useState(() => ({ current: initial }));
  const [remote] = useState(() => onRemote);
  const [saver] = useState(() =>
    createSaver({
      send: (patch, leaving) => sendPatch(pageId, patch, leaving, confirmed, onMerged),
      onStatus: (next) => {
        lastStatus.current = next;
        setStatus(next);
        if (next.state === "saved") setSavedCount((n) => n + 1);
      },
      onSaved,
    }),
  );

  useEffect(() => {
    const idle = () => lastStatus.current.state === "saved" && !saver.hasPending();
    async function refresh() {
      if (!remote || !idle()) return;
      const response = await fetch(`/api/pages/${pageId}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const data = (await response.json().catch(() => null)) as { page?: RemotePage } | null;
      const page = data?.page;
      // Une frappe partie pendant la lecture prime : la page relue attendra.
      if (!page || page.rev === confirmed.current.rev || !idle()) return;
      confirmed.current = { rev: page.rev, title: page.title, body: page.body };
      remote(page);
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saver.flush(true);
      else void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void saver.flush(true);
    };
  }, [saver, pageId, confirmed, remote, lastStatus]);

  useEffect(() => {
    if (status.state === "saved") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.state]);

  return { status, queue: saver.queue, cancel: saver.cancel, savedCount };
}

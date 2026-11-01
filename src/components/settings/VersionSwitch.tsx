"use client";
// Réglages › Version, sur le Mac (BRAINSTORMING §12, « Changer de version
// depuis Réglages ») : « Mettre à jour vers abc1234 », préparé en arrière-plan
// puis « Redémarrer maintenant », et « Revenir à la version de secours ». Le
// lanceur bascule pendant que la fenêtre attend ; elle se recharge dès que le
// nouveau serveur répond. Le retour en secours arrête la synchronisation : il
// se confirme au second clic, qui le dit (choix d'Antonin du 2026-11-01).
import { useCallback, useEffect, useState } from "react";
import { sameCommit, type Fallback, type PreparationState } from "@/lib/version_rules";
import { send } from "../request";

type Info = {
  current: { commit: string | null; schema: number };
  reachable: boolean;
  update: { commit: string; state: PreparationState } | null;
  fallback: (Fallback & { problem: string | null }) | null;
  pinned: boolean;
};

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeZone: "Europe/Brussels" });
const PREPARE_POLL_MS = 3_000;
const RESTART_POLL_MS = 1_000;
// Sauvegarde, bascule et démarrage tiennent en quelques secondes ; au-delà de
// trois minutes, quelque chose a mal tourné et le journal du lanceur le dit.
const RESTART_GIVE_UP_MS = 180_000;

const short = (commit: string) => commit.slice(0, 7);

async function readVersion(query = ""): Promise<Record<string, unknown> | null> {
  const response = await fetch(`/api/version${query}`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}

export function VersionSwitch() {
  const [info, setInfo] = useState<Info | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const data = await readVersion();
    if (data) setInfo(data as Info);
    else setUnavailable(true);
  }, []);

  useEffect(() => {
    // Différé d'un tour (react-hooks/set-state-in-effect), comme SyncStatus.
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  // Préparation en cours : relevé léger, sans interroger Coolify.
  const preparing = info?.update?.state === "en_cours" ? info.update.commit : null;
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(async () => {
      const data = await readVersion(`?commit=${preparing}`);
      const state = data?.preparation as PreparationState | undefined;
      if (!state) return;
      setInfo((previous) =>
        previous?.update?.commit === preparing ? { ...previous, update: { commit: preparing, state } } : previous,
      );
    }, PREPARE_POLL_MS);
    return () => clearInterval(timer);
  }, [preparing]);

  // Redémarrage : l'ancien serveur peut encore répondre juste après le clic.
  // On recharge quand le serveur sert la version visée, ou quand il revient
  // après une coupure avec une autre (bascule reportée : la ligne d'état dit
  // pourquoi).
  useEffect(() => {
    if (!restarting) return;
    let sawDown = false;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > RESTART_GIVE_UP_MS) {
        clearInterval(timer);
        setRestarting(null);
        setMessage("Le redémarrage tarde : voir journal/lancer.log dans le dossier de l'app.");
        return;
      }
      const data = await readVersion(`?commit=${restarting}`);
      if (!data) {
        sawDown = true;
        return;
      }
      const commit = (data.current as Info["current"] | undefined)?.commit ?? null;
      if (sameCommit(commit, restarting) || sawDown) window.location.reload();
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [restarting]);

  async function act(body: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    setConfirming(false);
    const result = await send("/api/version", "POST", body);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    if (typeof result.data.target === "string") setRestarting(result.data.target);
    else if (info?.update && typeof result.data.state === "string") {
      setInfo({ ...info, update: { ...info.update, state: result.data.state as PreparationState } });
    }
  }

  if (unavailable) return <p className="hint">État de la version illisible : rouvrir Réglages.</p>;
  if (!info) return <p className="hint">Recherche d&apos;une version plus récente…</p>;
  if (restarting) {
    return (
      <p className="hint" role="status">
        Redémarrage sur la version {short(restarting)}… La fenêtre se recharge d&apos;elle-même.
      </p>
    );
  }

  const { update, fallback, pinned, reachable } = info;
  return (
    <>
      <div className="settings-actions">
        {pinned && (
          <p className="hint">
            Version de secours épinglée : le lancement ne la met plus à jour, et le serveur refuse les échanges.
            « Mettre à jour » rend la version déployée.
          </p>
        )}
        {!reachable ? (
          <p className="hint">Coolify injoignable : impossible de savoir s&apos;il existe une version plus récente.</p>
        ) : !update ? (
          <p className="hint">À jour : c&apos;est la dernière version déployée.</p>
        ) : update.state === "en_cours" ? (
          <p className="hint" role="status">
            Préparation de la mise à jour vers {short(update.commit)}… une à deux minutes, l&apos;app reste utilisable.
          </p>
        ) : update.state === "prete" ? (
          <>
            <p className="hint">
              Version {short(update.commit)} prête. Redémarrer fait une sauvegarde, bascule, puis l&apos;app reste
              indisponible quelques secondes.
            </p>
            <button
              type="button"
              className="settings-submit"
              disabled={busy}
              onClick={() => void act({ action: "redemarrer", commit: update.commit })}
            >
              Redémarrer maintenant
            </button>
          </>
        ) : (
          <>
            {update.state === "echec" && (
              <p className="sync-error">
                La préparation a échoué (journal/preparer.log) ; la version actuelle continue.
              </p>
            )}
            <button
              type="button"
              className="settings-submit"
              disabled={busy}
              onClick={() => void act({ action: "preparer", commit: update.commit })}
            >
              {update.state === "echec" ? "Réessayer" : `Mettre à jour vers ${short(update.commit)}`}
            </button>
          </>
        )}
      </div>

      <div className="settings-actions">
        <p className="hint">
          {fallback ? (
            <>
              Version de secours : <code>{short(fallback.commit)}</code>, schéma du {DATE.format(new Date(fallback.schema))}.
              Sans réseau, en quelques secondes ; les modifications attendent en local jusqu&apos;à la prochaine mise à
              jour.
            </>
          ) : (
            "Aucune version de secours : elle apparaît après une première mise à jour."
          )}
        </p>
        {confirming && fallback ? (
          <div className="settings-confirm">
            <button type="button" className="danger" disabled={busy} onClick={() => void act({ action: "secours" })}>
              Revenir à {short(fallback.commit)} et arrêter la synchronisation
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !fallback || fallback.problem !== null}
            title={fallback?.problem ?? undefined}
            onClick={() => setConfirming(true)}
          >
            Revenir à la version de secours
          </button>
        )}
      </div>
      {message && <p className="sync-error">{message}</p>}
    </>
  );
}

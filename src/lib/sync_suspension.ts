// Suspension de la synchronisation (SPECS.md, « Suspension » et « Suspension
// automatique »), état gardé dans la table settings : il survit au
// redémarrage et ne se synchronise jamais. Le compte des pages abîmées est
// pur (countDamage, sync_client_plan.ts) ; ce module lit et écrit l'état.
import { getSetting, setSetting } from "./settings";
import { SYNC_THRESHOLD_DEFAULT, type SyncDirection, type SyncSuspension } from "./settings_rules";
import type { Damage } from "./sync_client_plan";

export function readSuspension(): Promise<SyncSuspension | null> {
  return getSetting("sync.suspended");
}

export async function readThreshold(): Promise<number> {
  return (await getSetting("sync.threshold")) ?? SYNC_THRESHOLD_DEFAULT;
}

// Sens dans lequel « Reprendre » a donné son accord pour le prochain lot.
export async function readWaiver(): Promise<SyncDirection | null> {
  return (await getSetting("sync.waiver"))?.direction ?? null;
}

export function clearWaiver(): Promise<void> {
  return setSetting("sync.waiver", null);
}

export function suspendManually(): Promise<void> {
  return setSetting("sync.suspended", { at: new Date().toISOString(), by: "manual" });
}

export function suspendForDamage(direction: SyncDirection, damage: Damage): Promise<void> {
  return setSetting("sync.suspended", {
    at: new Date().toISOString(),
    by: "auto",
    direction,
    count: damage.count,
    kinds: damage.kinds,
    titles: damage.titles,
  });
}

// Reprendre après une suspension automatique vaut accord pour le lot arrêté :
// le cycle suivant ne se suspend pas une seconde fois sur les mêmes pages.
export async function resume(): Promise<void> {
  const suspended = await readSuspension();
  if (suspended?.by === "auto") await setSetting("sync.waiver", { direction: suspended.direction });
  await setSetting("sync.suspended", null);
}

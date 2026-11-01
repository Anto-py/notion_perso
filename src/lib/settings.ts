// Lecture et écriture de la table settings (SPECS « Réglages, sauvegardes et
// suspension »). Les règles (clés, valeurs, sections) vivent dans
// settings_rules.ts, pur et testé.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { syncConfig } from "./sync_client";
import { readSettingValue, type Instance, type SettingKey, type SettingValues } from "./settings_rules";

// Le Mac se reconnaît à sa configuration de synchronisation ; tout le reste
// (VPS, développement) est l'app web.
export function currentInstance(): Instance {
  return syncConfig() ? "mac" : "web";
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K] | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return row ? readSettingValue(key, row.value) : null;
}

// null efface la clé : sa valeur par défaut reprend la main.
export async function setSetting<K extends SettingKey>(key: K, value: SettingValues[K] | null): Promise<void> {
  if (value === null) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

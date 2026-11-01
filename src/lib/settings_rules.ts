// Règles de la page Réglages (BRAINSTORMING §12, SPECS « Réglages,
// sauvegardes et suspension ») : sections par instance, clés écrivables et
// leurs valeurs, mot de passe. Pur : lib/settings.ts lit et écrit la table.

export type Instance = "mac" | "web";

export type SettingsSection = "compte" | "synchronisation" | "sauvegardes" | "version" | "appareils" | "vue_publique";

// Chaque instance n'affiche que ce qui la concerne, dans cet ordre.
const SECTIONS: Record<Instance, SettingsSection[]> = {
  web: ["compte", "version", "appareils", "vue_publique"],
  mac: ["compte", "synchronisation", "sauvegardes", "version"],
};

export function sectionsFor(instance: Instance): SettingsSection[] {
  return SECTIONS[instance];
}

// Valeur de chaque clé. Les clés des sauvegardes arrivent avec leurs paliers
// (SPECS, « Ordre de construction »).
export type SyncDirection = "up" | "down";
export type DamageCounts = { trashed: number; emptied: number; purged: number };
// Absente : synchronisation active. Automatique : le sens arrêté, le nombre de
// pages abîmées, leur répartition et cinq titres.
export type SyncSuspension =
  | { at: string; by: "manual" }
  | { at: string; by: "auto"; direction: SyncDirection; count: number; kinds: DamageCounts; titles: string[] };

export type SettingValues = {
  "public.site_name": string;
  "public.linkedin_url": string;
  "sync.suspended": SyncSuspension;
  "sync.threshold": number;
  // Accord donné par « Reprendre » pour le prochain lot dans ce sens.
  "sync.waiver": { direction: SyncDirection };
};

export type SettingKey = keyof SettingValues;

const SITE_NAME_MAX = 80;
export const SYNC_THRESHOLD_DEFAULT = 20;
const SYNC_THRESHOLD_MAX = 10_000;

type Parsed<T> = { value: T } | { error: string };

type Rule<K extends SettingKey> = {
  section: SettingsSection;
  // Écrivable par PATCH /api/reglages ; sinon seulement par sa route propre
  // (la suspension, par api/synchro/suspension).
  editable: boolean;
  // Valeur reçue du navigateur (non vide) ou lue en base → valeur normalisée,
  // ou message de refus.
  parse: (value: unknown) => Parsed<SettingValues[K]>;
};

function text(max: number, label: string) {
  return (value: unknown): Parsed<string> => {
    if (typeof value !== "string" || !value) return { error: "Valeur invalide" };
    return value.length > max ? { error: `${label} tient en ${max} caractères au plus` } : { value };
  };
}

function httpsUrl(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { error: "Valeur invalide" };
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return { value: url.href };
  } catch {
    // repli sur le refus
  }
  return { error: "Le lien doit être une adresse complète en https://" };
}

function threshold(value: unknown): Parsed<number> {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > SYNC_THRESHOLD_MAX) {
    return { error: `Le seuil est un nombre entier de pages, de 1 à ${SYNC_THRESHOLD_MAX}` };
  }
  return { value: n };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isDirection = (value: unknown): value is SyncDirection => value === "up" || value === "down";
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function suspension(value: unknown): Parsed<SyncSuspension> {
  const invalid = { error: "Valeur invalide" };
  if (!isRecord(value) || typeof value.at !== "string") return invalid;
  if (value.by === "manual") return { value: { at: value.at, by: "manual" } };
  const { direction, count, kinds, titles } = value;
  if (value.by !== "auto" || !isDirection(direction) || !isCount(count) || !isRecord(kinds)) return invalid;
  if (!isCount(kinds.trashed) || !isCount(kinds.emptied) || !isCount(kinds.purged)) return invalid;
  if (!Array.isArray(titles) || !titles.every((title) => typeof title === "string")) return invalid;
  return {
    value: {
      at: value.at,
      by: "auto",
      direction,
      count,
      kinds: { trashed: kinds.trashed, emptied: kinds.emptied, purged: kinds.purged },
      titles,
    },
  };
}

function waiver(value: unknown): Parsed<{ direction: SyncDirection }> {
  return isRecord(value) && isDirection(value.direction) ? { value: { direction: value.direction } } : { error: "Valeur invalide" };
}

const RULES: { [K in SettingKey]: Rule<K> } = {
  "public.site_name": { section: "vue_publique", editable: true, parse: text(SITE_NAME_MAX, "Le nom du site") },
  "public.linkedin_url": { section: "vue_publique", editable: true, parse: httpsUrl },
  "sync.suspended": { section: "synchronisation", editable: false, parse: suspension },
  "sync.threshold": { section: "synchronisation", editable: true, parse: threshold },
  "sync.waiver": { section: "synchronisation", editable: false, parse: waiver },
};

function isKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.hasOwn(RULES, key);
}

// null : la clé s'efface, et le repli (variable d'environnement, valeur par
// défaut) reprend la main.
export type SettingWrite =
  | { ok: true; key: SettingKey; value: SettingValues[SettingKey] | null }
  | { ok: false; error: string };

// Ce qu'un PATCH /api/reglages peut écrire : une clé connue et modifiable,
// d'une section affichée sur cette instance, et une valeur revalidée (texte
// du navigateur, ou nombre pour le seuil).
export function parseSettingWrite(instance: Instance, key: unknown, value: unknown): SettingWrite {
  if (!isKey(key) || !RULES[key].editable) return { ok: false, error: "Réglage inconnu" };
  const rule = RULES[key];
  if (!sectionsFor(instance).includes(rule.section)) return { ok: false, error: "Réglage indisponible sur cette instance" };
  if (typeof value !== "string" && typeof value !== "number") return { ok: false, error: "Valeur invalide" };
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return { ok: true, key, value: null };
  const parsed = rule.parse(raw);
  return "value" in parsed ? { ok: true, key, value: parsed.value } : { ok: false, error: parsed.error };
}

// Valeur lue en base : relue par la même règle, une forme inattendue vaut
// absence plutôt qu'une erreur au rendu.
export function readSettingValue<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] | null {
  const parsed = RULES[key].parse(raw);
  return "value" in parsed ? parsed.value : null;
}

// Choix d'Antonin du 2026-11-01.
export const PASSWORD_MIN = 10;

// La confirmation (nouveau saisi deux fois) se vérifie dans le navigateur ;
// le serveur ne reçoit que l'actuel et le nouveau.
export function newPasswordProblem(current: string, next: string): string | null {
  if (!current) return "Saisissez le mot de passe actuel";
  if (next.length < PASSWORD_MIN) return `Le nouveau mot de passe compte ${PASSWORD_MIN} caractères au moins`;
  if (next === current) return "Le nouveau mot de passe est identique à l'actuel";
  return null;
}

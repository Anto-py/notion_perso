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

// Valeur de chaque clé. Les clés de la synchronisation et des sauvegardes
// arrivent avec leurs paliers (SPECS, « Ordre de construction »).
export type SettingValues = {
  "public.site_name": string;
  "public.linkedin_url": string;
};

export type SettingKey = keyof SettingValues;

const SITE_NAME_MAX = 80;

type Rule<K extends SettingKey> = {
  section: SettingsSection;
  // Valeur non vide reçue du navigateur ou lue en base → valeur normalisée,
  // ou message de refus.
  parse: (value: string) => SettingValues[K] | { error: string };
};

function httpsUrl(value: string): string | { error: string } {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
  } catch {
    // repli sur le refus
  }
  return { error: "Le lien doit être une adresse complète en https://" };
}

const RULES: { [K in SettingKey]: Rule<K> } = {
  "public.site_name": {
    section: "vue_publique",
    parse: (value) =>
      value.length > SITE_NAME_MAX ? { error: `Le nom du site tient en ${SITE_NAME_MAX} caractères au plus` } : value,
  },
  "public.linkedin_url": { section: "vue_publique", parse: httpsUrl },
};

function isKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.hasOwn(RULES, key);
}

// null : la clé s'efface, et le repli (variable d'environnement, valeur par
// défaut) reprend la main.
export type SettingWrite = { ok: true; key: SettingKey; value: string | null } | { ok: false; error: string };

// Ce qu'un PATCH /api/reglages peut écrire : une clé connue, d'une section
// affichée sur cette instance, et une valeur revalidée.
export function parseSettingWrite(instance: Instance, key: unknown, value: unknown): SettingWrite {
  if (!isKey(key)) return { ok: false, error: "Réglage inconnu" };
  const rule = RULES[key];
  if (!sectionsFor(instance).includes(rule.section)) return { ok: false, error: "Réglage indisponible sur cette instance" };
  if (typeof value !== "string") return { ok: false, error: "Valeur invalide" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, key, value: null };
  const parsed = rule.parse(trimmed);
  return typeof parsed === "string" ? { ok: true, key, value: parsed } : { ok: false, error: parsed.error };
}

// Valeur lue en base : relue par la même règle, une forme inattendue vaut
// absence plutôt qu'une erreur au rendu.
export function readSettingValue<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] | null {
  if (typeof raw !== "string" || !raw) return null;
  const parsed = RULES[key].parse(raw);
  return typeof parsed === "string" ? parsed : null;
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

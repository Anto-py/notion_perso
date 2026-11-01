// Propriétés des bases, nombres et heures : saisie et écriture à la française,
// jour et heure à Bruxelles, dates ISO, valeurs Créé le et Modifié le.
import { LIMITS, isTimeType, type NumberFormat, type Property, type Values } from "./property_schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Saisie d'un nombre à la française ou à l'anglaise : « 1 234,5 », « 1234.5 »,
// « 12 % », « 3,50 € ». Avec une virgule, les points sont des séparateurs de
// milliers ; sans virgule, le point est décimal. null si ce n'est pas un nombre.
export function parseNumber(text: string): number | null {
  let cleaned = text.replace(/[\s\u00a0\u202f€%+]/g, "");
  if (cleaned.includes(",")) cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && Math.abs(value) < LIMITS.number ? value : null;
}

// Écriture d'un nombre à la française, à la main plutôt que par Intl : le
// serveur et le navigateur rendent le même texte (hydratation). Espace fine
// insécable entre les milliers, virgule décimale ; l'euro garde deux
// décimales, les autres formats au plus maxDecimals (bruit des flottants
// effacé).
export function formatNumber(value: number, format: NumberFormat = "number", maxDecimals = 10): string {
  const fixed = format === "euro" ? value.toFixed(2) : String(Number(value.toFixed(maxDecimals)));
  if (/e/i.test(fixed)) return fixed;
  const negative = fixed.startsWith("-");
  const [int, dec] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  const text = `${negative && fixed !== "-0" ? "-" : ""}${grouped}${dec ? `,${dec}` : ""}`;
  if (format === "euro") return `${text}\u00a0€`;
  if (format === "percent") return `${text}\u00a0%`;
  return text;
}

// Jour et heure d'un horodatage à Bruxelles, en chiffres : formatToParts ne
// rend que des nombres, identiques côté serveur et navigateur.
const BRUSSELS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function brusselsParts(iso: string): { day: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const parts = Object.fromEntries(BRUSSELS.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function isTimestamp(raw: unknown): raw is string {
  return typeof raw === "string" && raw.includes("T") && !Number.isNaN(Date.parse(raw));
}

// Valeurs d'une entrée complétées de ses propriétés Créé le et Modifié le.
// Appelé à l'affichage seulement : ces valeurs ne s'écrivent jamais en base.
export function withTimes(properties: readonly Property[], values: Values, times: { createdAt: string; updatedAt: string }): Values {
  const timed = properties.filter((prop) => isTimeType(prop.type));
  if (timed.length === 0) return values;
  const next = { ...values };
  for (const prop of timed) next[prop.id] = prop.type === "created_time" ? times.createdAt : times.updatedAt;
  return next;
}

export function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

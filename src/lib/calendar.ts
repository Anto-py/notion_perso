// Calendrier d'une base : calcul des jours, sans React ni base. Toutes les
// dates sont des jours civils « AAAA-MM-JJ » (BRAINSTORMING §4), jamais des
// instants : l'arithmétique se fait en UTC pour qu'aucun changement d'heure
// ne décale un jour. La semaine commence le lundi.
import type { EntryRow } from "./properties";

export const CALENDAR_SCALES = ["month", "week"] as const;
export type CalendarScale = (typeof CALENDAR_SCALES)[number];
export const CALENDAR_SCALE_LABELS: Record<CalendarScale, string> = { month: "Mois", week: "Semaine" };
export const CALENDAR_SCALE_DEFAULT: CalendarScale = "month";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function utc(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Un jour civil valide : la forme, puis la réalité du calendrier (le 31 avril
// n'existe pas). Une valeur d'import douteuse est ainsi traitée comme absente.
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const date = utc(value);
  return iso(date) === value;
}

// Jour de Bruxelles, celui que voit Antonin à l'écran.
export function todayInBrussels(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day: string, delta: number): string {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return iso(date);
}

// Lundi de la semaine du jour donné (dimanche compte pour la semaine finie).
export function weekStart(day: string): string {
  const index = (utc(day).getUTCDay() + 6) % 7;
  return addDays(day, -index);
}

export function weekDays(anchor: string): string[] {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

// Mois voisin, le jour ramené à la fin du mois quand il n'existe pas
// (31 janvier plus un mois donne 28 ou 29 février).
export function addMonths(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + delta, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date, lastDay));
  return iso(first);
}

// Jours affichés pour un mois : du lundi qui précède le 1er au dimanche qui
// suit le dernier, semaines entières. Une grille de quatre à six semaines,
// selon le mois, jamais de ligne vide.
export function monthDays(anchor: string): string[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const offset = (utc(first).getUTCDay() + 6) % 7;
  const lastDay = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate();
  const total = Math.ceil((offset + lastDay) / 7) * 7;
  const start = addDays(first, -offset);
  return Array.from({ length: total }, (_, index) => addDays(start, index));
}

// Entrées rangées par jour, dans l'ordre reçu (celui des tris de la vue).
export function entriesByDay(entries: readonly EntryRow[], datePropId: string): Map<string, EntryRow[]> {
  const byDay = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const value = entry.values[datePropId];
    if (!isIsoDay(value)) continue;
    const list = byDay.get(value);
    if (list) list.push(entry);
    else byDay.set(value, [entry]);
  }
  return byDay;
}

// Entrées du calendrier sans date lisible : listées à part, jamais perdues.
export function undatedEntries(entries: readonly EntryRow[], datePropId: string): EntryRow[] {
  return entries.filter((entry) => !isIsoDay(entry.values[datePropId]));
}

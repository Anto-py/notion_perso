// Conversion du Vide-cerveau (étape 18, palier c) : une ligne `is_inbox` née
// base devient la page, ses entrées sont abandonnées (décision d'Antonin du
// 2026-11-10). Module pur : il dit ce qu'il faut écrire, la requête et le
// script l'appliquent. Extensions .ts explicites : le script tourne sous Node.
import type { PageKind } from "./bases.ts";

export type InboxRow = {
  id: string;
  type: PageKind;
  trashed: boolean;
  isInbox: boolean;
  // Entrées de la base, corbeille comprise : toutes partent.
  entries: number;
};

export type InboxPlan = {
  inboxId: string | null;
  convert: boolean;
  purgeEntries: number;
  report: { found: boolean; alreadyPage: boolean; converted: boolean; purged: number };
};

export class InboxConversionError extends Error {}

export function planInboxPage(rows: readonly InboxRow[]): InboxPlan {
  const inbox = rows.find((row) => row.isInbox && !row.trashed) ?? null;
  if (!inbox) {
    return {
      inboxId: null,
      convert: false,
      purgeEntries: 0,
      report: { found: false, alreadyPage: false, converted: false, purged: 0 },
    };
  }
  if (inbox.type === "page") {
    return {
      inboxId: inbox.id,
      convert: false,
      purgeEntries: 0,
      report: { found: true, alreadyPage: true, converted: false, purged: 0 },
    };
  }
  if (inbox.type !== "database") {
    throw new InboxConversionError(`Le Vide-cerveau porte un type inattendu : ${inbox.type}.`);
  }
  return {
    inboxId: inbox.id,
    convert: true,
    purgeEntries: inbox.entries,
    report: { found: true, alreadyPage: false, converted: true, purged: inbox.entries },
  };
}

export function describeInboxPlan(plan: InboxPlan): string {
  if (!plan.report.found) return "Vide-cerveau : aucune ligne, rien à faire.";
  if (plan.report.alreadyPage) return "Vide-cerveau : déjà une page, rien à faire.";
  const entries = plan.report.purged === 1 ? "1 entrée purgée" : `${plan.report.purged} entrées purgées`;
  return `Vide-cerveau : base convertie, ${entries}, ligne remontée à la racine.`;
}

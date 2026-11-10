import { describe, expect, it } from "vitest";
import { InboxConversionError, describeInboxPlan, planInboxPage, type InboxRow } from "@/lib/inbox_page_move";

const row = (extra: Partial<InboxRow> = {}): InboxRow => ({
  id: "pg_wIRJ8hbbBOSl3LNt",
  type: "database",
  trashed: false,
  isInbox: true,
  entries: 2,
  ...extra,
});

describe("planInboxPage", () => {
  it("convertit une base et compte ses entrées", () => {
    expect(planInboxPage([row()])).toEqual({
      inboxId: "pg_wIRJ8hbbBOSl3LNt",
      convert: true,
      purgeEntries: 2,
      report: { found: true, alreadyPage: false, converted: true, purged: 2 },
    });
  });

  it("ne touche pas une page déjà convertie", () => {
    const plan = planInboxPage([row({ type: "page", entries: 0 })]);
    expect(plan.convert).toBe(false);
    expect(plan.report).toMatchObject({ found: true, alreadyPage: true, purged: 0 });
  });

  it("ignore une ligne en corbeille et une absence de ligne", () => {
    expect(planInboxPage([row({ trashed: true })]).report.found).toBe(false);
    expect(planInboxPage([]).report.found).toBe(false);
    expect(planInboxPage([]).inboxId).toBeNull();
  });

  it("refuse un type inattendu", () => {
    expect(() => planInboxPage([row({ type: "entry" })])).toThrow(InboxConversionError);
  });
});

describe("describeInboxPlan", () => {
  it("nomme les trois états et le compte des entrées", () => {
    expect(describeInboxPlan(planInboxPage([]))).toBe("Vide-cerveau : aucune ligne, rien à faire.");
    expect(describeInboxPlan(planInboxPage([row({ type: "page" })]))).toBe("Vide-cerveau : déjà une page, rien à faire.");
    expect(describeInboxPlan(planInboxPage([row()]))).toBe("Vide-cerveau : base convertie, 2 entrées purgées, ligne remontée à la racine.");
    expect(describeInboxPlan(planInboxPage([row({ entries: 1 })]))).toContain("1 entrée purgée");
  });
});

import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  entriesByDay,
  isIsoDay,
  monthDays,
  todayInBrussels,
  undatedEntries,
  weekDays,
  weekStart,
} from "@/lib/calendar";
import type { EntryRow } from "@/lib/properties";

const entry = (id: string, date?: string): EntryRow => ({
  id,
  title: id,
  icon: null,
  values: date ? { prop_date: date } : {},
  manualOrder: id,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

describe("jours civils", () => {
  it("reconnaît un jour réel, refuse une forme ou une date impossible", () => {
    expect(isIsoDay("2026-11-01")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2026-04-31")).toBe(false);
    expect(isIsoDay("2026-11-1")).toBe(false);
    expect(isIsoDay("2026-11-01T10:00:00Z")).toBe(false);
    expect(isIsoDay(null)).toBe(false);
  });

  it("avance et recule d'un jour, d'un mois à l'autre et d'une année à l'autre", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("donne le lundi de la semaine, dimanche compris", () => {
    // Le 1er novembre 2026 est un dimanche.
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-10-28")).toBe("2026-10-26");
    expect(weekDays("2026-11-01")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("change de mois en ramenant le jour à la fin du mois", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("grille du mois", () => {
  it("couvre le mois en semaines entières, du lundi au dimanche", () => {
    // Novembre 2026 commence un dimanche : la grille part du lundi 26 octobre.
    const days = monthDays("2026-11-01");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26");
    expect(days[6]).toBe("2026-11-01");
    expect(days[41]).toBe("2026-12-06");
    expect(days).toContain("2026-11-30");
  });

  it("ne dessine aucune ligne vide : février 2026 tient en cinq semaines", () => {
    const days = monthDays("2026-02-10");
    expect(days).toHaveLength(35);
    expect(days[0]).toBe("2026-01-26");
    expect(days[34]).toBe("2026-03-01");
  });
});

describe("jour de Bruxelles", () => {
  it("change de jour à minuit local, pas à minuit UTC", () => {
    expect(todayInBrussels(new Date("2026-11-01T10:00:00Z"))).toBe("2026-11-01");
    expect(todayInBrussels(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
    expect(todayInBrussels(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });
});

describe("rangement des entrées", () => {
  it("range par jour dans l'ordre reçu et laisse à part celles sans date", () => {
    const rows = [entry("a", "2026-11-02"), entry("b", "2026-11-01"), entry("c", "2026-11-02"), entry("d"), entry("e", "pas une date")];
    const byDay = entriesByDay(rows, "prop_date");
    expect(byDay.get("2026-11-02")?.map((row) => row.id)).toEqual(["a", "c"]);
    expect(byDay.get("2026-11-01")?.map((row) => row.id)).toEqual(["b"]);
    expect(undatedEntries(rows, "prop_date").map((row) => row.id)).toEqual(["d", "e"]);
  });
});

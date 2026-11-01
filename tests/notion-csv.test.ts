import { describe, expect, it } from "vitest";
import { buildCsvDatabase, parseCsv, parseNotionDate, type CsvContext } from "@/lib/notion-csv";

function context(overrides: Partial<CsvContext> = {}): CsvContext {
  let next = 0;
  return {
    makeId: (prefix) => `${prefix}_${next++}`,
    resolveLink: () => null,
    ...overrides,
  };
}

const NOTION_URL = "https://www.notion.so/Page-0123456789abcdef0123456789abcdef";

describe("parseCsv", () => {
  it("retire le BOM et garde les champs entre guillemets", () => {
    const table = parseCsv('﻿Name,Tags,Note\nPage 1,"a, b","ligne 1\nligne 2"\n');
    expect(table.header).toEqual(["Name", "Tags", "Note"]);
    expect(table.rows).toEqual([["Page 1", "a, b", "ligne 1\nligne 2"]]);
  });

  it("ignore les lignes vides", () => {
    expect(parseCsv("A,B\n1,2\n\n\n3,4\n").rows).toEqual([["1", "2"], ["3", "4"]]);
  });
});

describe("parseNotionDate", () => {
  it("accepte l'ISO et l'ISO horodatée", () => {
    expect(parseNotionDate("2026-10-30")).toBe("2026-10-30");
    expect(parseNotionDate("2026-10-30T14:05:00Z")).toBe("2026-10-30");
  });

  it("accepte les dates longues anglaises et françaises, avec heure", () => {
    expect(parseNotionDate("January 15, 2024")).toBe("2024-01-15");
    expect(parseNotionDate("15 janvier 2024")).toBe("2024-01-15");
    expect(parseNotionDate("7 février 2025 10:07")).toBe("2025-02-07");
  });

  it("lit le format numérique français et refuse une date impossible", () => {
    expect(parseNotionDate("01/02/2024")).toBe("2024-02-01");
    expect(parseNotionDate("32/13/2024")).toBeNull();
  });

  it("réduit une plage à sa date de début", () => {
    expect(parseNotionDate("19/03/2025 → 23/03/2025")).toBe("2025-03-19");
  });
});

describe("buildCsvDatabase", () => {
  const csv = [
    "Name,Statut,Tags,Fait,Échéance,Site,Notes",
    'Article A,À faire,"veille, ia",Yes,2024-01-15,https://exemple.be,"une note, avec virgule"',
    'Article B,Terminé,veille,No,2024-02-01,https://autre.be,une autre note',
  ].join("\n");

  it("déduit les types et crée les options", () => {
    const { config } = buildCsvDatabase(parseCsv(csv), context());
    expect(config.properties.map((prop) => [prop.name, prop.type])).toEqual([
      ["Statut", "select"],
      ["Tags", "multiselect"],
      ["Fait", "checkbox"],
      ["Échéance", "date"],
      ["Site", "url"],
      ["Notes", "text"],
    ]);
    const statut = config.properties[0];
    expect(statut.options?.map((option) => option.name)).toEqual(["À faire", "Terminé"]);
  });

  it("remplit les valeurs par identifiant de propriété", () => {
    const { config, entries } = buildCsvDatabase(parseCsv(csv), context());
    const [statut, tags, fait, echeance, site] = config.properties;
    expect(entries[0].title).toBe("Article A");
    expect(entries[0].values[statut.id]).toBe(statut.options?.[0].id);
    expect(entries[0].values[tags.id]).toEqual([tags.options?.[0].id, tags.options?.[1].id]);
    expect(entries[0].values[fait.id]).toBe(true);
    expect(entries[1].values[fait.id]).toBeUndefined();
    expect(entries[0].values[echeance.id]).toBe("2024-01-15");
    expect(entries[0].values[site.id]).toBe("https://exemple.be");
  });

  it("ignore une colonne vide et le note", () => {
    const { config, ignored } = buildCsvDatabase(parseCsv("Name,Vide\nA,\nB,\n"), context());
    expect(config.properties).toEqual([]);
    expect(ignored).toEqual([{ reason: "colonne vide « Vide »", count: 1 }]);
  });

  it("convertit une relation vers une page ordinaire en texte et en liens", () => {
    const ctx = context({
      resolveLink: (href) => (href === NOTION_URL ? { href: "/page/pg_1", title: "Page liée", pageId: "pg_1", kind: "page" } : null),
    });
    const { config, entries, notes } = buildCsvDatabase(parseCsv(`Name,Lié\nA,${NOTION_URL}\n`), ctx);
    expect(config.properties[0]).toMatchObject({ name: "Lié", type: "text" });
    expect(entries[0].values[config.properties[0].id]).toBe("Page liée");
    expect(entries[0].extraMarkdown).toBe(`**Lié** : [Page liée](${NOTION_URL})`);
    expect(notes[0].reason).toContain("convertie en texte");
  });

  it("importe une relation quand toutes les cellules citent des entrées d'une même base", () => {
    const links: Record<string, { pageId: string; title: string }> = {
      "https://notion.so/a": { pageId: "pg_a", title: "Horta" },
      "https://notion.so/b": { pageId: "pg_b", title: "Van de Velde" },
    };
    const ctx = context({
      resolveLink: (href) => {
        const link = links[href];
        return link
          ? { href: `/page/${link.pageId}`, title: link.title, pageId: link.pageId, kind: "page", dbId: "pg_veille", dbTitle: "Veille" }
          : null;
      },
    });
    const csv = ['Name,Ressources', 'A,https://notion.so/a', 'B,"https://notion.so/a, https://notion.so/b"'].join("\n");
    const { config, entries, notes } = buildCsvDatabase(parseCsv(csv), ctx);
    expect(config.properties[0]).toMatchObject({ name: "Ressources", type: "relation", target: "pg_veille", single: false });
    expect(entries[0].values[config.properties[0].id]).toEqual(["pg_a"]);
    expect(entries[1].values[config.properties[0].id]).toEqual(["pg_a", "pg_b"]);
    expect(notes[0].reason).toBe("relation « Ressources » importée vers « Veille »");
  });

  it("laisse en texte une colonne qui cite deux bases", () => {
    const ctx = context({
      resolveLink: (href) => ({
        href: `/page/${href}`,
        title: href,
        pageId: href,
        kind: "page",
        dbId: href === "https://notion.so/a" ? "pg_a" : "pg_b",
        dbTitle: "Une base",
      }),
    });
    const csv = ['Name,Lien', "A,https://notion.so/a", "B,https://notion.so/b"].join("\n");
    const { config, notes } = buildCsvDatabase(parseCsv(csv), ctx);
    expect(config.properties[0]).toMatchObject({ type: "text" });
    expect(notes[0].reason).toContain("convertie en texte");
  });

  it("laisse en texte une cellule qui mêle du texte à un lien", () => {
    const ctx = context({
      resolveLink: () => ({ href: "/page/pg_a", title: "A", pageId: "pg_a", kind: "page", dbId: "pg_veille", dbTitle: "Veille" }),
    });
    const { config, notes } = buildCsvDatabase(parseCsv("Name,Lien\nA,voir https://notion.so/a\n"), ctx);
    expect(config.properties[0]).toMatchObject({ type: "text" });
    expect(notes[0].reason).toContain("convertie en texte");
  });

  it("renomme une colonne qui prendrait le nom réservé du titre", () => {
    const { config } = buildCsvDatabase(parseCsv("Name,Titre\nA,x\n"), context());
    expect(config.properties[0].name).toBe("Titre 2");
  });

  it("type une colonne de dates françaises et garde la plage dans le corps", () => {
    const { config, entries, notes } = buildCsvDatabase(
      parseCsv("Nom,Début\nA,7 février 2025 10:07\nB,19/03/2025 → 23/03/2025\n"),
      context(),
    );
    expect(config.properties[0]).toMatchObject({ name: "Début", type: "date" });
    expect(entries[0].values[config.properties[0].id]).toBe("2025-02-07");
    expect(entries[1].values[config.properties[0].id]).toBe("2025-03-19");
    expect(entries[1].extraMarkdown).toContain("19/03/2025 → 23/03/2025");
    expect(notes.some((note) => note.reason.includes("plage de dates"))).toBe(true);
  });

  it("type une colonne numérique, son format et ses valeurs", () => {
    const { config, entries } = buildCsvDatabase(
      parseCsv('Nom,Durée,Prix,Taux,Tél,Séances\nA,12,"3,50 €",50%,0470 12 34 56,"1, 2"\nB,"1 234,5",10 €,5%,0470 98 76 54,"2, 3"\n'),
      context(),
    );
    expect(config.properties.map((prop) => [prop.name, prop.type, prop.format])).toEqual([
      ["Durée", "number", "number"],
      ["Prix", "number", "euro"],
      ["Taux", "number", "percent"],
      ["Tél", "select", undefined],
      ["Séances", "multiselect", undefined],
    ]);
    const [duree, prix] = config.properties;
    expect(entries.map((entry) => entry.values[duree.id])).toEqual([12, 1234.5]);
    expect(entries.map((entry) => entry.values[prix.id])).toEqual([3.5, 10]);
    expect(config.views).toHaveLength(1);
  });

  it("ne prend pas une phrase à virgule pour une sélection multiple", () => {
    const { config } = buildCsvDatabase(parseCsv('Nom,Prix\nA,Gratuit\nB,"Gratuit, open source"\nC,Freemium\n'), context());
    expect(config.properties[0].type).toBe("text");
  });

  it("s'arrête à la limite de propriétés et le note", () => {
    const header = ["Name", ...Array.from({ length: 55 }, (_, index) => `Colonne ${index}`)];
    const row = ["A", ...Array.from({ length: 55 }, () => "x")];
    const { config, ignored } = buildCsvDatabase(parseCsv(`${header.join(",")}\n${row.join(",")}\n`), context());
    expect(config.properties).toHaveLength(50);
    expect(ignored.some((item) => item.reason.includes("au-delà de 50 propriétés"))).toBe(true);
  });
});

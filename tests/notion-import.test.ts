import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildImportPlan, CONTAINER_TITLE, NotionImportError } from "@/lib/notion-import";

const ROOT_ID = "a".repeat(32);
const CHILD_ID = "b".repeat(32);
const DB_ID = "c".repeat(32);
const ENTRY_ID = "d".repeat(32);

function ids() {
  let next = 0;
  return {
    newId: (prefix: string) => `${prefix}_${String(next++).padStart(16, "0")}`,
    newBlockId: () => `blk_${next++}`,
  };
}

function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);
  return zipSync(entries);
}

const ROOT_DIR = `Veille ${ROOT_ID}`;
const CHILD = `Article ${CHILD_ID}.md`;
const DB = `Tâches ${DB_ID}.csv`;
const ENTRY = `Première ${ENTRY_ID}.md`;

function sample(): Uint8Array {
  return archive({
    [`Veille ${ROOT_ID}.md`]: [
      "# Veille",
      "",
      "Un paragraphe d'introduction.",
      "",
      `[${CHILD.replace(".md", "")}](${encodeURI(`${ROOT_DIR}/${CHILD}`)})`,
      "",
      `![Schéma](${encodeURI(`${ROOT_DIR}/image.png`)})`,
    ].join("\n"),
    [`${ROOT_DIR}/${CHILD}`]: "## Article\n\nLe corps de l'article.",
    [`${ROOT_DIR}/${DB}`]: "Name,Statut,Échéance\nPremière,À faire,2024-01-15\n",
    [`${ROOT_DIR}/Tâches ${DB_ID}/${ENTRY}`]: "Le corps de l'entrée.",
    [`${ROOT_DIR}/image.png`]: "PNG",
    [`${ROOT_DIR}/document.docx`]: "DOCX",
  });
}

describe("buildImportPlan", () => {
  it("reconstruit l'arbre, la base, l'entrée et le média", () => {
    const plan = buildImportPlan(sample(), ids());
    const byTitle = new Map(plan.pages.map((page) => [page.title, page]));

    const root = byTitle.get("Veille")!;
    const child = byTitle.get("Article")!;
    const database = byTitle.get("Tâches")!;
    const entry = byTitle.get("Première")!;

    expect(plan.rootId).toBe(root.id);
    expect(child.parentId).toBe(root.id);
    expect(database.parentId).toBe(root.id);
    expect(entry.dbId).toBe(database.id);
    expect(entry.type).toBe("entry");

    const subpage = root.body.find((block) => block.type === "subpage");
    expect(subpage?.props).toEqual({ pageId: child.id, kind: "page" });
    expect(entry.bodyText).toContain("corps de l'entrée");
    expect(database.dbConfig?.properties.map((prop) => [prop.name, prop.type])).toEqual([
      ["Statut", "select"],
      ["Échéance", "date"],
    ]);

    const statut = database.dbConfig!.properties[0];
    expect(entry.propertyValues?.[statut.id]).toBe(statut.options?.[0].id);
    expect(entry.valuesText).toContain("À faire");

    expect(plan.media).toHaveLength(1);
    expect(plan.media[0]).toMatchObject({ mime: "image/png", originalName: "image.png", pageId: root.id });
    expect(plan.media[0].storedName).toMatch(/^up_[A-Za-z0-9_-]{16}\.png$/);
    const image = root.body.find((block) => block.type === "image");
    expect(image?.props.url).toBe(`/api/media/${plan.media[0].storedName}`);
  });

  it("rapporte les pages, bases, entrées, médias et les fichiers ignorés", () => {
    const { report } = buildImportPlan(sample(), ids());
    expect(report.counts).toEqual({ pages: 2, databases: 1, entries: 1, media: 1 });
    expect(report.rootTitle).toBe("Veille");
    expect(report.ignored).toEqual([{ reason: "fichier non pris en charge", count: 1 }]);
  });

  it("rattache le corps d'une entrée quand le dossier porte le titre de la base", () => {
    const plan = buildImportPlan(
      archive({
        [`Base ${DB_ID}.csv`]: "Name,Statut\nPremière,À faire\n",
        [`Base/Première ${ENTRY_ID}.md`]: "Le corps de l'entrée.",
      }),
      ids(),
    );
    const entry = plan.pages.find((page) => page.type === "entry");
    expect(entry?.bodyText).toContain("corps de l'entrée");
    expect(plan.pages.some((page) => page.type === "page" && page.title === "Première")).toBe(false);
  });

  it("regroupe plusieurs racines dans une page conteneur", () => {
    const plan = buildImportPlan(
      archive({
        [`A ${ROOT_ID}.md`]: "A",
        [`B ${CHILD_ID}.md`]: "B",
      }),
      ids(),
    );
    const container = plan.pages.find((page) => page.id === plan.rootId)!;
    expect(container.title).toBe(CONTAINER_TITLE);
    expect(container.parentId).toBeNull();
    expect(plan.pages.filter((page) => page.parentId === container.id).map((page) => page.title)).toEqual(["A", "B"]);
    expect(plan.report.notes).toContainEqual({ reason: "racines de l'export regroupées dans une page conteneur", count: 1 });
  });

  it("importe une colonne de liens en vraie relation entre deux bases", () => {
    const VEILLE_ID = "e".repeat(32);
    const SEQ_ID = "f".repeat(32);
    const HORTA_ID = "1".repeat(32);
    const VELDE_ID = "2".repeat(32);
    const plan = buildImportPlan(
      archive({
        [`Veille ${VEILLE_ID}.csv`]: "Name,Note\nHorta,4\nVan de Velde,6\n",
        [`Veille ${VEILLE_ID}/Horta ${HORTA_ID}.md`]: "Horta",
        [`Veille ${VEILLE_ID}/Van de Velde ${VELDE_ID}.md`]: "Van de Velde",
        [`Séquences ${SEQ_ID}.csv`]: `Name,Ressources\nSéquence,https://www.notion.so/Horta-${HORTA_ID}\n`,
      }),
      ids(),
    );
    const sequence = plan.pages.find((page) => page.title === "Séquence")!;
    const database = plan.pages.find((page) => page.id === sequence.dbId)!;
    const veille = plan.pages.find((page) => page.title === "Veille")!;
    const horta = plan.pages.find((page) => page.title === "Horta")!;
    const relation = database.dbConfig!.properties.find((prop) => prop.name === "Ressources")!;
    expect(relation).toMatchObject({ type: "relation", target: veille.id });
    expect(sequence.propertyValues?.[relation.id]).toEqual([horta.id]);
    expect(plan.report.notes).toContainEqual({ reason: "relation « Ressources » importée vers « Veille »", count: 1 });
  });

  it("refuse un export HTML", () => {
    expect(() => buildImportPlan(archive({ [`Note ${ROOT_ID}.html`]: "<p>x</p>" }), ids())).toThrow(NotionImportError);
  });

  it("refuse une archive sans page ni base", () => {
    expect(() => buildImportPlan(archive({ "readme.txt": "x" }), ids())).toThrow(NotionImportError);
  });
});

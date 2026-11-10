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
    // La racine des bases, lue par son rôle en production (étape 17).
    basesRootId: "pg_basesracine00000",
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
    const plan = buildImportPlan(sample(), { ...ids(), now: new Date("2026-11-05T22:30:00Z") });
    const byTitle = new Map(plan.pages.map((page) => [page.title, page]));

    const root = byTitle.get("Veille")!;
    const child = byTitle.get("Article")!;
    const database = byTitle.get("Tâches")!;
    const entry = byTitle.get("Première")!;

    expect(plan.rootId).toBe(root.id);
    expect(child.parentId).toBe(root.id);
    expect(entry.dbId).toBe(database.id);
    expect(entry.type).toBe("entry");

    // Étape 16 : la base rejoint un dossier d'import sous « Bases », écrit en
    // tête du plan ; sa page la montre par une vue liée ajoutée en fin de page.
    const folder = plan.pages[0];
    expect(folder).toMatchObject({ type: "folder", parentId: "pg_basesracine00000", title: "Import Notion du 2026-11-05" });
    expect(database.parentId).toBe(folder.id);
    expect(root.body.at(-1)).toEqual({ id: `linked-${database.id}`, type: "linked", props: { databaseId: database.id, config: "" }, children: [] });

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

  // Format des exports de 2026 (mesuré sur deux archives réelles, octobre et
  // novembre) : le dossier d'une page ne porte que son titre, sans identifiant.
  it("range sous leur page les sous-pages d'un dossier qui ne porte que le titre", () => {
    const KEYS_ID = "3".repeat(32);
    const PDF_ID = "4".repeat(32);
    const TIP_ID = "5".repeat(32);
    const TOOLS_ID = "6".repeat(32);
    const plan = buildImportPlan(
      archive({
        [`Privé/Clés en main ${KEYS_ID}.md`]: "# Clés en main",
        [`Privé/Clés en main/Retravailler un pdf ${PDF_ID}.md`]: "Le pdf.",
        [`Privé/Clés en main/Retravailler un pdf/Astuce ${TIP_ID}.md`]: "L'astuce.",
        [`Privé/Clés en main/Outils ${TOOLS_ID}_all.csv`]: "Name\nCanva\n",
        [`Privé/Autre ${CHILD_ID}.md`]: "Autre racine.",
      }),
      ids(),
    );
    const byTitle = (title: string) => plan.pages.find((page) => page.title === title)!;
    expect(byTitle("Clés en main").parentId).toBe(plan.rootId);
    expect(byTitle("Retravailler un pdf").parentId).toBe(byTitle("Clés en main").id);
    expect(byTitle("Astuce").parentId).toBe(byTitle("Retravailler un pdf").id);
    expect(byTitle("Outils").parentId).toBe(plan.pages[0].id);
    expect(byTitle("Clés en main").body.some((block) => block.type === "linked" && block.props.databaseId === byTitle("Outils").id)).toBe(true);
  });

  it("ne devine pas le parent quand deux pages du même titre partagent un dossier", () => {
    const TWIN_ID = "7".repeat(32);
    const NOTE_ID = "8".repeat(32);
    const plan = buildImportPlan(
      archive({
        [`Sans titre ${ROOT_ID}.md`]: "Un.",
        [`Sans titre ${TWIN_ID}.md`]: "Deux.",
        [`Sans titre/Note ${NOTE_ID}.md`]: "À qui ?",
      }),
      ids(),
    );
    const note = plan.pages.find((page) => page.title === "Note")!;
    expect(note.parentId).toBe(plan.rootId);
    expect(plan.report.notes).toContainEqual({
      reason: "page rangée dans la page conteneur : son dossier porte le titre de deux pages",
      count: 1,
    });
  });

  // Export HTML : le format porte icônes, bandeaux, dépliants, colonnes,
  // tableaux et l'ordre des sous-pages (BRAINSTORMING §8).
  it("importe un export HTML, bandeau cadré, icône et ordre des sous-pages", () => {
    const page = (inner: string, header = "") =>
      `<html><body><article id="x"><header>${header}</header><div class="page-body">${inner}</div></article></body></html>`;
    const ROOT = `Privé/Clés en main ${ROOT_ID}.html`;
    const CHILD = `Privé/Clés en main/Enfant ${CHILD_ID}.html`;
    const DB = `Privé/Clés en main/Base ${DB_ID}.csv`;
    const ENTRY = `Privé/Clés en main/Base/Entrée ${ENTRY_ID}.html`;
    const plan = buildImportPlan(
      archive({
        [ROOT]: page(
          `<figure class="link-to-page"><a href="Cl%C3%A9s%20en%20main/Enfant%20${CHILD_ID}.html" data-notion-page-id="${CHILD_ID}">Enfant</a></figure>
           <table class="collection-content"><tbody><tr><td>Entrée</td></tr></tbody></table>`,
          `<img class="page-cover-image" src="Clés en main/cover.png" style="object-position:center 20%"/>
           <div class="page-header-icon page-header-icon-with-cover"><span class="icon" data-emoji="🔑"></span></div>
           <h1 class="page-title">Clés en main</h1>`,
        ),
        [CHILD]: page("<p>Le corps de l'enfant.</p>", `<h1 class="page-title">Enfant</h1>`),
        [DB]: "Name,Statut\nEntrée,À faire\n",
        [ENTRY]: page("<p>Le corps de l'entrée.</p>", `<h1 class="page-title">Entrée</h1>`),
        [`Privé/Clés en main/cover.png`]: "PNG",
      }),
      ids(),
    );
    const byTitle = (title: string) => plan.pages.find((item) => item.title === title)!;
    const root = byTitle("Clés en main");
    const child = byTitle("Enfant");
    const database = byTitle("Base");
    const entry = byTitle("Entrée");

    expect(plan.rootId).toBe(root.id);
    expect(child.parentId).toBe(root.id);
    expect(child.manualOrder).toBe(0);
    expect(database.parentId).toBe(plan.pages.find((item) => item.type === "folder")!.id);
    expect(entry.dbId).toBe(database.id);
    expect(entry.bodyText).toContain("corps de l'entrée");

    expect(root.icon).toBe("🔑");
    expect(root.cover).toMatch(/^image:up_[A-Za-z0-9_-]{16}\.png$/);
    expect(root.coverPosition).toBe(20);
    expect(plan.media.find((item) => item.originalName === "cover.png")?.pageId).toBe(root.id);
    // La vue liée de l'export HTML suffit : aucune seconde ne s'ajoute.
    expect(root.body.filter((block) => block.type === "linked" && block.props.databaseId === database.id)).toHaveLength(1);
    expect(plan.report.counts).toMatchObject({ pages: 2, databases: 1, entries: 1, media: 1 });
  });

  it("range une image d'icône en bibliothèque, une seule fois par contenu", () => {
    const html = (title: string) =>
      `<article><header><div class="page-header-icon undefined"><img class="icon" src="${title}/icon.png"/></div>
       <h1 class="page-title">${title}</h1></header><div class="page-body"></div></article>`;
    const plan = buildImportPlan(
      archive({
        [`A ${ROOT_ID}.html`]: html("A"),
        [`B ${CHILD_ID}.html`]: html("B"),
        [`A/icon.png`]: "PNG",
        [`B/icon.png`]: "PNG",
      }),
      ids(),
    );
    expect(plan.icons).toHaveLength(1);
    expect(plan.media.filter((item) => item.pageId === null)).toHaveLength(1);
    const icons = plan.pages.filter((page) => ["A", "B"].includes(page.title)).map((page) => page.icon);
    expect(icons[0]).toBe(icons[1]);
    expect(icons[0]).toMatch(/^image:up_[A-Za-z0-9_-]{16}\.png$/);
  });

  it("refuse une archive sans page ni base", () => {
    expect(() => buildImportPlan(archive({ "readme.txt": "x" }), ids())).toThrow(NotionImportError);
  });
});

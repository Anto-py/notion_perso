import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  indexArchive,
  NotionImportError,
  splitNotionName,
  unpackZip,
  type ArchiveEntry,
} from "@/lib/notion-archive";

const ID = "0123456789abcdef0123456789abcdef";
const ID2 = "fedcba9876543210fedcba9876543210";

function entry(path: string, text = ""): ArchiveEntry {
  return { path, bytes: strToU8(text) };
}

describe("splitNotionName", () => {
  it("retire le suffixe de 32 hexadécimaux", () => {
    expect(splitNotionName(`Veille ${ID}`)).toEqual({ title: "Veille", notionId: ID, all: false });
  });

  it("reconnaît le suffixe _all d'un CSV complet", () => {
    expect(splitNotionName(`Tâches ${ID}_all`)).toEqual({ title: "Tâches", notionId: ID, all: true });
  });

  it("accepte un UUID à tirets", () => {
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";
    expect(splitNotionName(`Espace ${uuid}`)).toEqual({ title: "Espace", notionId: uuid, all: false });
  });

  it("laisse un nom sans identifiant tel quel", () => {
    expect(splitNotionName("Sans identifiant")).toEqual({ title: "Sans identifiant", notionId: "", all: false });
  });
});

describe("unpackZip", () => {
  it("dézippe le zip contenu dans le zip téléchargé", () => {
    const inner = zipSync({ [`Note ${ID}.md`]: strToU8("# Note") });
    const outer = zipSync({ [`ExportBlock-abc-Part-1.zip`]: inner });
    const { files, warnings } = unpackZip(outer);
    expect(files.map((file) => file.path)).toEqual([`Note ${ID}.md`]);
    expect(warnings).toEqual([]);
  });

  it("fusionne plusieurs Part-N.zip", () => {
    const part1 = zipSync({ [`A ${ID}.md`]: strToU8("a") });
    const part2 = zipSync({ [`B ${ID2}.md`]: strToU8("b") });
    const outer = zipSync({ "ExportBlock-x-Part-1.zip": part1, "ExportBlock-x-Part-2.zip": part2 });
    expect(unpackZip(outer).files).toHaveLength(2);
  });

  it("ignore __MACOSX, les dossiers et les traversées de chemin", () => {
    const zip = zipSync({
      "__MACOSX/._note.md": strToU8("x"),
      ".DS_Store": strToU8("x"),
      "../evasion.md": strToU8("x"),
      "dossier/": new Uint8Array(),
      [`Note ${ID}.md`]: strToU8("ok"),
    });
    const { files, warnings } = unpackZip(zip);
    expect(files.map((file) => file.path)).toEqual([`Note ${ID}.md`]);
    expect(warnings).toContain("Chemin ignoré : ../evasion.md");
  });

  it("refuse une archive qui n'est pas un zip", () => {
    expect(() => unpackZip(strToU8("pas un zip"))).toThrow(NotionImportError);
  });
});

describe("indexArchive", () => {
  it("apparie la page à son dossier jumeau et range les médias", () => {
    const archive = indexArchive([
      entry(`Parent ${ID}.md`),
      entry(`Parent ${ID}/Enfant ${ID2}.md`),
      entry(`Parent ${ID}/image.png`),
      entry(`Parent ${ID}/document.docx`),
    ]);
    expect(archive.pages.map((page) => page.title)).toEqual(["Parent", "Enfant"]);
    expect(archive.rootPages.map((page) => page.title)).toEqual(["Parent"]);
    expect(archive.media.map((item) => item.path)).toEqual([`Parent ${ID}/image.png`]);
    expect(archive.others.map((item) => item.path)).toEqual([`Parent ${ID}/document.docx`]);
  });

  it("retient le CSV _all et écarte celui de vue", () => {
    const archive = indexArchive([
      entry(`Tâches ${ID}.csv`),
      entry(`Tâches ${ID}_all.csv`),
    ]);
    expect(archive.databases).toHaveLength(1);
    expect(archive.databases[0].path).toBe(`Tâches ${ID}_all.csv`);
    expect(archive.warnings.join(" ")).toContain("CSV complet");
  });

  it("reconnaît les lignes de base et le stub qui décrit la base", () => {
    const archive = indexArchive([
      entry(`Tâches ${ID}.md`),
      entry(`Tâches ${ID}.csv`),
      entry(`Tâches ${ID}/Première ${ID2}.md`),
    ]);
    expect(archive.databases).toHaveLength(1);
    expect(archive.stubs.map((item) => item.title)).toEqual(["Tâches"]);
    expect(archive.entries.map((item) => item.title)).toEqual(["Première"]);
    expect(archive.pages).toEqual([]);
  });

  it("reconnaît les entrées quand le dossier porte le titre de la base", () => {
    const archive = indexArchive([
      entry(`Exemples TICE ${ID}.csv`),
      entry(`Exemples TICE ${ID}_all.csv`),
      entry(`Exemples TICE/Entrée ${ID2}.md`),
    ]);
    expect(archive.entries.map((item) => item.title)).toEqual(["Entrée"]);
    expect(archive.pages).toEqual([]);
  });

  it("signale un export HTML", () => {
    const archive = indexArchive([entry(`Note ${ID}.html`)]);
    expect(archive.htmlOnly).toBe(true);
  });

  it("laisse une sous-page d'entrée de base hors de l'arbre", () => {
    const archive = indexArchive([
      entry(`Tâches ${ID}.csv`),
      entry(`Tâches ${ID}/Première ${ID2}.md`),
      entry(`Tâches ${ID}/Première ${ID2}/Détail ${"a".repeat(32)}.md`),
    ]);
    expect(archive.entries).toHaveLength(1);
    expect(archive.warnings.join(" ")).toContain("sous-page d'entrée de base");
  });
});

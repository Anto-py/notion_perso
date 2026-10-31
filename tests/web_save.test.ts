import { describe, expect, it } from "vitest";
import { CONFLICT_BLOCK, mergeDbConfig, type ConflictProps } from "@/lib/sync_merge";
import { mergeWebSave, planBlockRuns, rebaseTyping, type Run } from "@/lib/web_save";

const T_SERVER = "2026-10-31T11:00:00.000Z";
const NOW = "2026-10-31T12:00:00.000Z";

type Block = { id: string; type: string; props: Record<string, unknown>; children: Block[]; content?: { text: string }[] };

function block(id: string, text: string): Block {
  return { id, type: "paragraph", props: {}, content: [{ text }], children: [] };
}

function ids() {
  let n = 0;
  return () => `new_${++n}`;
}

const texts = (blocks: unknown[]) =>
  (blocks as Block[]).map((b) => (b.type === CONFLICT_BLOCK ? `[${b.children.map((c) => c.content?.[0].text).join()}]` : b.content?.[0].text));

describe("mergeWebSave", () => {
  it("garde le bloc ajouté ailleurs et la frappe d'ici", () => {
    const base = [block("a", "un"), block("b", "deux")];
    const mine = [block("a", "un, retouché"), block("b", "deux")];
    const server = [block("a", "un"), block("b", "deux"), block("c", "trois, du Mac")];
    const { fields, conflicts } = mergeWebSave({ body: base }, { body: mine }, { title: "", body: server, updatedAt: T_SERVER }, NOW);
    expect(texts(fields.body!)).toEqual(["un, retouché", "deux", "trois, du Mac"]);
    expect(conflicts).toBe(0);
  });

  it("un même bloc changé des deux côtés : la frappe gagne, l'autre version reste encadrée", () => {
    const base = [block("a", "un")];
    const { fields, conflicts } = mergeWebSave(
      { body: base },
      { body: [block("a", "un, ici")] },
      { title: "", body: [block("a", "un, ailleurs")], updatedAt: T_SERVER },
      NOW,
      ids(),
    );
    expect(texts(fields.body!)).toEqual(["un, ici", "[un, ailleurs]"]);
    expect(conflicts).toBe(1);
    const props = (fields.body![1] as Block).props as ConflictProps;
    expect(props).toEqual({ origin: "other", date: T_SERVER, replaces: "a" });
  });

  it("un bloc supprimé ici et modifié ailleurs revient encadré", () => {
    const { fields } = mergeWebSave(
      { body: [block("a", "un"), block("b", "deux")] },
      { body: [block("a", "un")] },
      { title: "", body: [block("a", "un"), block("b", "deux, ailleurs")], updatedAt: T_SERVER },
      NOW,
      ids(),
    );
    expect(texts(fields.body!)).toEqual(["un", "[deux, ailleurs]"]);
  });

  it("le titre envoyé l'emporte, un champ absent n'est pas écrit", () => {
    const { fields } = mergeWebSave({ title: "A" }, { title: "B" }, { title: "C", body: [], updatedAt: T_SERVER }, NOW);
    expect(fields).toEqual({ title: "B" });
  });
});

describe("rebaseTyping", () => {
  it("sans frappe pendant l'aller-retour, la version fusionnée passe telle quelle", () => {
    const sent = [block("a", "un")];
    const merged = [block("a", "un"), block("c", "trois")];
    expect(rebaseTyping(sent, sent, merged, NOW)).toBe(merged);
  });

  it("une frappe arrivée pendant l'aller-retour se repose sur la version fusionnée", () => {
    const sent = [block("a", "un")];
    const current = [block("a", "un, et la suite")];
    const merged = [block("a", "un"), block("c", "trois")];
    expect(texts(rebaseTyping(sent, current, merged, NOW))).toEqual(["un, et la suite", "trois"]);
  });
});

describe("planBlockRuns", () => {
  const a = block("a", "un");
  const b = block("b", "deux");
  const c = block("c", "trois");

  it("rien à faire si le document est déjà la cible", () => {
    expect(planBlockRuns([a, b], [a, b])).toEqual([]);
  });

  it("un bloc ajouté s'insère entre ses voisins gardés", () => {
    expect(planBlockRuns([a, c], [a, b, c])).toEqual<Run[]>([{ remove: [], insert: [b], after: "a", before: "c" }]);
  });

  it("un bloc changé est remplacé seul, ses voisins restent", () => {
    const b2 = block("b", "deux, changé");
    expect(planBlockRuns([a, b, c], [a, b2, c])).toEqual<Run[]>([{ remove: ["b"], insert: [b2], after: "a", before: "c" }]);
  });

  it("un bloc retiré au début du document", () => {
    expect(planBlockRuns([a, b], [b])).toEqual<Run[]>([{ remove: ["a"], insert: [], after: null, before: "b" }]);
  });

  it("deux passages distincts donnent deux remplacements", () => {
    const a2 = block("a", "un, changé");
    const d = block("d", "quatre");
    expect(planBlockRuns([a, b, c], [a2, b, c, d])).toEqual<Run[]>([
      { remove: ["a"], insert: [a2], after: null, before: "b" },
      { remove: [], insert: [d], after: "c", before: null },
    ]);
  });

  it("un bloc déplacé est retiré puis réinséré, le reste ne bouge pas", () => {
    const runs = planBlockRuns([a, b, c], [b, c, a]);
    const removed = runs.flatMap((run) => run.remove);
    const inserted = runs.flatMap((run) => run.insert);
    expect(removed).toEqual(["a"]);
    expect(inserted).toEqual([a]);
  });
});

describe("mergeDbConfig", () => {
  const prop = (id: string, name: string) => ({ id, name, type: "text" });
  const view = (id: string, name: string) => ({ id, name, kind: "table", group_by: null, filters: [], sorts: [], hidden: [], hidden_columns: {}, calcs: {} });

  it("une vue ajoutée ailleurs reste quand on en renomme une ici", () => {
    const base = { properties: [prop("p1", "Lien")], views: [view("v1", "Tableau")] };
    const mine = { properties: base.properties, views: [view("v1", "Tout")] };
    const server = { properties: base.properties, views: [view("v1", "Tableau"), view("v2", "À lire")] };
    const merged = mergeDbConfig(base, mine, server, true) as { views: { id: string; name: string }[] };
    expect(merged.views.map((v) => `${v.id}:${v.name}`)).toEqual(["v1:Tout", "v2:À lire"]);
  });
});

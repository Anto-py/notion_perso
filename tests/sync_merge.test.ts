import { describe, expect, it } from "vitest";
import { CONFLICT_BLOCK, mergePage, type SyncPage } from "@/lib/sync_merge";
import { parseConfig } from "@/lib/views";

// Base commune à 10 h, Mac à 11 h, web à 12 h : le web est le plus récent,
// sauf quand un test avance l'horloge du Mac.
const T0 = "2026-10-31T10:00:00.000Z";
const T_MAC = "2026-10-31T11:00:00.000Z";
const T_WEB = "2026-10-31T12:00:00.000Z";
const LATER = "2026-10-31T13:00:00.000Z";

function page(over: Partial<SyncPage> = {}): SyncPage {
  return {
    id: "pg_1",
    parentId: null,
    type: "page",
    title: "Veille",
    icon: null,
    cover: null,
    coverPosition: null,
    body: [],
    dbConfig: null,
    dbId: null,
    propertyValues: null,
    inboxKind: null,
    isInbox: false,
    manualOrder: "a0",
    shareEnabled: false,
    publicId: null,
    shareIncludeSubpages: true,
    createdAt: T0,
    updatedAt: T0,
    trashedAt: null,
    ...over,
  };
}

function block(id: string, text: string, children: unknown[] = []) {
  return { id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children };
}

function ids() {
  let n = 0;
  return () => `new_${++n}`;
}

type Block = { id: string; type: string; props: Record<string, unknown>; children: Block[]; content?: { text: string }[] };
const bodyOf = (result: { page: SyncPage }) => result.page.body as Block[];
const texts = (blocks: Block[]) => blocks.map((b) => (b.type === CONFLICT_BLOCK ? `[${b.children.map((c) => c.content?.[0].text).join()}]` : b.content?.[0].text));

describe("mergePage : champs", () => {
  it("un changement d'un seul côté passe tel quel", () => {
    const base = page();
    const mac = page({ title: "Veille IA", updatedAt: T_MAC });
    const web = page({ icon: "📚", updatedAt: T_WEB });
    const { page: merged, conflicts } = mergePage(base, mac, web);
    expect(merged.title).toBe("Veille IA");
    expect(merged.icon).toBe("📚");
    expect(conflicts).toBe(0);
    expect(merged.updatedAt).toBe(T_WEB);
  });

  it("un même champ changé des deux côtés : le plus récent gagne", () => {
    const base = page();
    expect(mergePage(base, page({ title: "Mac", updatedAt: T_MAC }), page({ title: "Web", updatedAt: T_WEB })).page.title).toBe("Web");
    expect(mergePage(base, page({ title: "Mac", updatedAt: LATER }), page({ title: "Web", updatedAt: T_WEB })).page.title).toBe("Mac");
  });

  it("le bandeau voyage d'un bloc : image et cadrage ne se mêlent pas", () => {
    const base = page({ cover: "up_a.png", coverPosition: 50 });
    const mac = page({ cover: "up_b.png", coverPosition: 50, updatedAt: T_MAC });
    const web = page({ cover: "up_a.png", coverPosition: 10, updatedAt: T_WEB });
    const merged = mergePage(base, mac, web).page;
    expect([merged.cover, merged.coverPosition]).toEqual(["up_a.png", 10]);
  });

  it("le partage voyage d'un bloc : état et lien du même côté", () => {
    const base = page();
    const mac = page({ shareEnabled: true, publicId: "lien_mac", updatedAt: LATER });
    const web = page({ shareEnabled: true, publicId: "lien_web", shareIncludeSubpages: false, updatedAt: T_WEB });
    const merged = mergePage(base, mac, web).page;
    expect([merged.publicId, merged.shareIncludeSubpages]).toEqual(["lien_mac", true]);
  });

  it("sans base commune, tout écart compte comme un conflit", () => {
    const mac = page({ title: "Mac", icon: "🍎", updatedAt: T_MAC });
    const web = page({ title: "Web", icon: "🍎", updatedAt: T_WEB });
    const merged = mergePage(null, mac, web).page;
    expect([merged.title, merged.icon]).toEqual(["Web", "🍎"]);
  });

  it("mise à la corbeille d'un côté, renommage de l'autre : les deux passent", () => {
    const merged = mergePage(page(), page({ trashedAt: T_MAC, updatedAt: T_MAC }), page({ title: "Neuf", updatedAt: T_WEB })).page;
    expect([merged.trashedAt, merged.title]).toEqual([T_MAC, "Neuf"]);
  });
});

describe("mergePage : valeurs de propriétés", () => {
  const entry = (values: Record<string, unknown> | null, over: Partial<SyncPage> = {}) =>
    page({ type: "entry", dbId: "db_a", propertyValues: values, ...over });

  it("valeur par valeur", () => {
    const base = entry({ p1: "a", p2: "b" });
    const mac = entry({ p1: "A", p2: "b" }, { updatedAt: T_MAC });
    const web = entry({ p1: "a", p2: "b", p3: true }, { updatedAt: T_WEB });
    expect(mergePage(base, mac, web).page.propertyValues).toEqual({ p1: "A", p2: "b", p3: true });
  });

  it("une valeur effacée d'un côté reste effacée", () => {
    const base = entry({ p1: "a", p2: "b" });
    const mac = entry({ p2: "b" }, { updatedAt: T_MAC });
    const web = entry({ p1: "a", p2: "B" }, { updatedAt: T_WEB });
    expect(mergePage(base, mac, web).page.propertyValues).toEqual({ p2: "B" });
  });

  it("une même valeur changée des deux côtés : le plus récent gagne", () => {
    const base = entry({ p1: ["o1"] });
    const mac = entry({ p1: ["o1", "o2"] }, { updatedAt: LATER });
    const web = entry({ p1: [] }, { updatedAt: T_WEB });
    expect(mergePage(base, mac, web).page.propertyValues).toEqual({ p1: ["o1", "o2"] });
  });

  it("entrée déplacée d'un côté : valeurs, base, type et ordre suivent ce côté", () => {
    const base = entry({ p1: "a" }, { inboxKind: "link", manualOrder: "a3" });
    const mac = entry({ q1: "a" }, { dbId: "db_b", inboxKind: null, manualOrder: "a9", updatedAt: T_MAC });
    const web = entry({ p1: "modifié" }, { inboxKind: "link", manualOrder: "a3", title: "Titre web", updatedAt: T_WEB });
    const merged = mergePage(base, mac, web).page;
    expect(merged).toMatchObject({ dbId: "db_b", propertyValues: { q1: "a" }, inboxKind: null, manualOrder: "a9", title: "Titre web" });
  });

  it("entrée déplacée des deux côtés vers deux bases : le plus récent gagne", () => {
    const base = entry({ p1: "a" });
    const mac = entry({ q1: "a" }, { dbId: "db_b", manualOrder: "a1", updatedAt: T_MAC });
    const web = entry({ r1: "a" }, { dbId: "db_c", manualOrder: "a2", updatedAt: T_WEB });
    expect(mergePage(base, mac, web).page).toMatchObject({ dbId: "db_c", propertyValues: { r1: "a" }, manualOrder: "a2" });
  });

  it("entrée déplacée des deux côtés vers la même base : fusion sans base commune", () => {
    const base = entry({ p1: "a" });
    const mac = entry({ q1: "a", q2: "mac" }, { dbId: "db_b", updatedAt: T_MAC });
    const web = entry({ q1: "a", q3: "web" }, { dbId: "db_b", updatedAt: T_WEB });
    expect(mergePage(base, mac, web).page.propertyValues).toEqual({ q1: "a", q2: "mac", q3: "web" });
  });

  it("ligne renvoyée sans base : une valeur d'un seul côté reste, un écart va au plus récent", () => {
    const mac = entry({ p1: "mac", p2: "auteur" }, { updatedAt: T_MAC });
    const web = entry({ p1: "web", p3: 4 }, { updatedAt: T_WEB });
    expect(mergePage(null, mac, web).page.propertyValues).toEqual({ p1: "web", p2: "auteur", p3: 4 });
  });
});

describe("mergePage : corps bloc par bloc", () => {
  it("ajouts des deux côtés : chacun garde son voisin précédent", () => {
    const base = page({ body: [block("a", "A"), block("b", "B"), block("c", "C")] });
    const mac = page({ body: [block("a", "A"), block("x", "X"), block("b", "B"), block("c", "C")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A"), block("b", "B"), block("c", "C"), block("y", "Y")], updatedAt: T_WEB });
    const result = mergePage(base, mac, web);
    expect(texts(bodyOf(result))).toEqual(["A", "X", "B", "C", "Y"]);
    expect(result.conflicts).toBe(0);
  });

  it("blocs différents modifiés de chaque côté : aucun conflit", () => {
    const base = page({ body: [block("a", "A"), block("b", "B")] });
    const mac = page({ body: [block("a", "A mac"), block("b", "B")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A"), block("b", "B web")], updatedAt: T_WEB });
    const result = mergePage(base, mac, web);
    expect(texts(bodyOf(result))).toEqual(["A mac", "B web"]);
    expect(result.conflicts).toBe(0);
  });

  it("un même bloc modifié des deux côtés : le perdant dans un encadré juste en dessous", () => {
    const base = page({ body: [block("a", "A"), block("b", "B")] });
    const mac = page({ body: [block("a", "A mac"), block("b", "B")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A web"), block("b", "B")], updatedAt: T_WEB });
    const result = mergePage(base, mac, web, ids());
    const body = bodyOf(result);
    expect(texts(body)).toEqual(["A web", "[A mac]", "B"]);
    expect(result.conflicts).toBe(1);
    expect(body[1]).toMatchObject({ type: CONFLICT_BLOCK, props: { origin: "mac", date: T_MAC, replaces: "a" } });
    // L'encadré et sa copie portent des ids neufs : aucun doublon avec « a ».
    expect(body[1].id).not.toBe("a");
    expect(body[1].children[0].id).not.toBe("a");
  });

  it("supprimé d'un côté, modifié de l'autre : la modification revient encadrée", () => {
    const base = page({ body: [block("a", "A"), block("b", "B")] });
    const mac = page({ body: [block("b", "B")], updatedAt: LATER });
    const web = page({ body: [block("a", "A web"), block("b", "B mod")], updatedAt: T_WEB });
    const result = mergePage(base, mac, web, ids());
    expect(texts(bodyOf(result))).toEqual(["[A web]", "B mod"]);
    expect(bodyOf(result)[0].props).toMatchObject({ origin: "web", replaces: "a" });
    expect(result.conflicts).toBe(1);
  });

  it("supprimé d'un côté, intact de l'autre : la suppression passe", () => {
    const base = page({ body: [block("a", "A"), block("b", "B")] });
    const mac = page({ body: [block("b", "B")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A"), block("b", "B web")], updatedAt: T_WEB });
    expect(texts(bodyOf(mergePage(base, mac, web)))).toEqual(["B web"]);
  });

  it("enfants fusionnés sous un parent modifié d'un seul côté", () => {
    const base = page({ body: [block("a", "A", [block("a1", "A1")])] });
    const mac = page({ body: [block("a", "A mac", [block("a1", "A1")])], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A", [block("a1", "A1"), block("a2", "A2")])], updatedAt: T_WEB });
    const body = bodyOf(mergePage(base, mac, web));
    expect(texts(body)).toEqual(["A mac"]);
    expect(texts(body[0].children)).toEqual(["A1", "A2"]);
  });

  it("réordonné d'un seul côté : l'ordre suit ce côté", () => {
    const base = page({ body: [block("a", "A"), block("b", "B"), block("c", "C")] });
    const mac = page({ body: [block("c", "C"), block("a", "A"), block("b", "B")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A"), block("b", "B web"), block("c", "C")], updatedAt: T_WEB });
    expect(texts(bodyOf(mergePage(base, mac, web)))).toEqual(["C", "A", "B web"]);
  });

  it("bloc déplacé des deux côtés sous deux parents : la seconde occurrence reçoit un id neuf", () => {
    const base = page({ body: [block("p", "P"), block("q", "Q"), block("m", "M")] });
    const mac = page({ body: [block("p", "P", [block("m", "M")]), block("q", "Q")], updatedAt: T_MAC });
    const web = page({ body: [block("p", "P"), block("q", "Q", [block("m", "M")])], updatedAt: T_WEB });
    const body = bodyOf(mergePage(base, mac, web, ids()));
    const all = body.flatMap((b) => [b.id, ...b.children.map((c) => c.id)]);
    expect(new Set(all).size).toBe(all.length);
    expect(body.map((b) => b.children.length)).toEqual([1, 1]);
  });

  it("sans base commune : union, et conflit sur un bloc divergent", () => {
    const mac = page({ body: [block("a", "A mac"), block("m", "M")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A web"), block("w", "W")], updatedAt: T_WEB });
    const result = mergePage(null, mac, web, ids());
    // Ce que le côté le plus ancien est seul à porter se colle à son voisin
    // précédent : M suit A, avant W.
    expect(texts(bodyOf(result))).toEqual(["A web", "[A mac]", "M", "W"]);
    expect(result.conflicts).toBe(1);
  });

  it("colonnes : jamais d'encadré entre deux colonnes, mais bien dans une colonne", () => {
    const columns = (left: unknown[], width: number) => [
      { id: "cl", type: "columnList", props: {}, children: [
        { id: "c1", type: "column", props: { width }, children: left },
        { id: "c2", type: "column", props: { width: 1 }, children: [block("r", "R")] },
      ] },
    ];
    const base = page({ body: columns([block("l", "L")], 1) });
    const mac = page({ body: columns([block("l", "L mac")], 0.8), updatedAt: T_MAC });
    const web = page({ body: columns([block("l", "L web")], 1.2), updatedAt: T_WEB });
    const result = mergePage(base, mac, web, ids());
    const list = bodyOf(result)[0];
    expect(list.children.map((c) => c.type)).toEqual(["column", "column"]);
    expect(list.children[0].props.width).toBe(1.2);
    expect(texts(list.children[0].children)).toEqual(["L web", "[L mac]"]);
    expect(result.conflicts).toBe(1);
  });

  it("corps illisible en liste à ids : le plus récent l'emporte en entier", () => {
    const base = page({ body: [block("a", "A")] });
    const mac = page({ body: [block("a", "A"), block("a", "doublon")], updatedAt: T_MAC });
    const web = page({ body: [block("a", "A web")], updatedAt: T_WEB });
    expect(texts(bodyOf(mergePage(base, mac, web)))).toEqual(["A web"]);
  });
});

describe("mergePage : configuration d'une base", () => {
  const select = (id: string, name: string, options: { id: string; name: string }[] = []) => ({
    id,
    name,
    type: "select",
    options: options.map((o) => ({ ...o, color: "gray" })),
  });
  const view = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, kind: "table", ...extra });
  const db = (properties: unknown[], views: unknown[] = [view("v1", "Tableau")], over: Partial<SyncPage> = {}) =>
    page({ type: "database", dbConfig: { properties, views }, ...over });
  const config = (result: { page: SyncPage }) => parseConfig(result.page.dbConfig);

  it("propriétés ajoutées de chaque côté : les deux restent", () => {
    const base = db([]);
    const mac = db([{ id: "p_mac", name: "Auteur", type: "text" }], undefined, { updatedAt: T_MAC });
    const web = db([{ id: "p_web", name: "Lien", type: "url" }], undefined, { updatedAt: T_WEB });
    expect(config(mergePage(base, mac, web)).properties.map((p) => p.name).sort()).toEqual(["Auteur", "Lien"]);
  });

  it("deux propriétés de même nom créées chacune de son côté : la seconde est renommée", () => {
    const base = db([]);
    const mac = db([select("p_mac", "Statut")], undefined, { updatedAt: T_MAC });
    const web = db([select("p_web", "Statut")], undefined, { updatedAt: T_WEB });
    const merged = config(mergePage(base, mac, web));
    expect(merged.properties.map((p) => p.name).sort()).toEqual(["Statut", "Statut 2"]);
  });

  it("options créées à la volée de chaque côté sur la même Sélection : les deux restent", () => {
    const base = db([select("p1", "Statut", [{ id: "o1", name: "À lire" }])]);
    const mac = db([select("p1", "Statut", [{ id: "o1", name: "À lire" }, { id: "o_mac", name: "Lu" }])], undefined, { updatedAt: T_MAC });
    const web = db([select("p1", "Statut", [{ id: "o1", name: "À lire" }, { id: "o_web", name: "Classé" }])], undefined, { updatedAt: T_WEB });
    const options = config(mergePage(base, mac, web)).properties[0].options!.map((o) => o.name);
    expect(options).toEqual(["À lire", "Lu", "Classé"]);
  });

  it("une option nommée « Titre » garde son nom", () => {
    const base = db([select("p1", "Rubrique", [{ id: "o1", name: "Titre" }])]);
    const mac = db([select("p1", "Rubrique", [{ id: "o1", name: "Titre" }, { id: "o2", name: "Chapeau" }])], undefined, { updatedAt: T_MAC });
    const web = db([select("p1", "Rubrique", [{ id: "o1", name: "Titre" }, { id: "o3", name: "Corps" }])], undefined, { updatedAt: T_WEB });
    const options = config(mergePage(base, mac, web)).properties[0].options!.map((o) => o.name);
    expect(options).toContain("Titre");
    expect(options).not.toContain("Titre 2");
  });

  it("propriété supprimée d'un côté, renommée de l'autre : le plus récent tranche", () => {
    const base = db([{ id: "p1", name: "Note", type: "text" }]);
    const macDeletes = db([], undefined, { updatedAt: LATER });
    const webRenames = db([{ id: "p1", name: "Remarque", type: "text" }], undefined, { updatedAt: T_WEB });
    expect(config(mergePage(base, macDeletes, webRenames)).properties).toEqual([]);
    const macDeletesEarlier = db([], undefined, { updatedAt: T_MAC });
    expect(config(mergePage(base, macDeletesEarlier, webRenames)).properties.map((p) => p.name)).toEqual(["Remarque"]);
  });

  it("vue retouchée d'un côté, propriété ajoutée de l'autre : les deux passent", () => {
    const base = db([{ id: "p1", name: "Note", type: "text" }], [view("v1", "Tableau")]);
    const mac = db([{ id: "p1", name: "Note", type: "text" }], [view("v1", "Tableau", { hidden: ["p1"] })], { updatedAt: T_MAC });
    const web = db([{ id: "p1", name: "Note", type: "text" }, { id: "p2", name: "Lien", type: "url" }], [view("v1", "Tableau")], { updatedAt: T_WEB });
    const merged = config(mergePage(base, mac, web));
    expect(merged.properties.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(merged.views[0].hidden).toEqual(["p1"]);
  });

  it("une vue qui filtre une propriété supprimée de l'autre côté perd ce filtre", () => {
    const base = db([{ id: "p1", name: "Note", type: "text" }], [view("v1", "Tableau")]);
    const mac = db([{ id: "p1", name: "Note", type: "text" }], [view("v1", "Tableau", { filters: [{ prop: "p1", op: "contains", value: "x" }] })], { updatedAt: T_MAC });
    const web = db([], [view("v1", "Tableau")], { updatedAt: T_WEB });
    const merged = config(mergePage(base, mac, web));
    expect(merged.properties).toEqual([]);
    expect(merged.views[0].filters).toEqual([]);
  });

  it("vues créées de chaque côté : les deux restent", () => {
    const base = db([], [view("v1", "Tableau")]);
    const mac = db([], [view("v1", "Tableau"), view("v_mac", "Liste", { kind: "list" })], { updatedAt: T_MAC });
    const web = db([], [view("v1", "Tableau"), view("v_web", "Tableau 2")], { updatedAt: T_WEB });
    expect(config(mergePage(base, mac, web)).views.map((v) => v.id)).toEqual(["v1", "v_mac", "v_web"]);
  });
});

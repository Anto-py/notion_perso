import { describe, expect, it } from "vitest";
import { ConversionError, EMPTY_PAGE_TITLES, planBasesPage, type ConvertRow } from "@/lib/bases_page_move";

const ROOT = "pg_bases_donnees";
const OLD = "pg_basesracine00000";

const row = (id: string, overrides: Partial<ConvertRow> = {}): ConvertRow => ({
  id,
  parentId: null,
  type: "page",
  title: id,
  icon: null,
  cover: null,
  coverPosition: null,
  body: [],
  trashed: false,
  isBasesRoot: false,
  isInbox: false,
  liveEntries: 0,
  manualOrder: "a0",
  ...overrides,
});

const linked = (id: string, databaseId: string) => ({ id, type: "linked", props: { databaseId, config: "" }, children: [] });
const subpage = (id: string, pageId: string) => ({ id, type: "subpage", props: { pageId }, children: [] });

const BASE_IDS = {
  bots: "pg_bots",
  tice: "pg_tice",
  prompts: "pg_prompts",
  ressources: "pg_ressources",
  todo: "pg_todo",
  todoDup: "pg_todo_dup",
  inbox: "pg_inbox",
  vibe: "pg_vibe",
  prompting: "pg_prompting",
  philippe: "pg_philippe",
  virements: "pg_virements",
};

const PAGE_IDS = {
  bots: "pg_page_bots",
  tice: "pg_page_tice",
  prompts: "pg_page_prompts",
  ressources: "pg_page_ressources",
  todo: "pg_page_todo",
};

function fixture(): ConvertRow[] {
  const root = row(ROOT, {
    title: "Bases de données",
    parentId: "ressources",
    cover: "color:sable",
    body: [
      linked("b1", BASE_IDS.bots),
      subpage("b2", PAGE_IDS.tice),
      linked("b3", BASE_IDS.prompts),
      linked("b4", BASE_IDS.ressources),
      linked("b5", BASE_IDS.todo),
    ],
  });
  const old = row(OLD, { title: "Bases", type: "folder", isBasesRoot: true });
  const base = (id: string, title: string, extra: Partial<ConvertRow> = {}) =>
    row(id, { type: "database", title, parentId: OLD, ...extra });
  return [
    root,
    old,
    row(PAGE_IDS.bots, { title: "Bot's", parentId: ROOT, icon: "🤖" }),
    row(PAGE_IDS.tice, { title: "Exemples TICE", parentId: ROOT, icon: "🎓", cover: "up_cover.jpg", coverPosition: 30 }),
    row(PAGE_IDS.prompts, { title: "Prompts", parentId: ROOT, icon: "✨" }),
    row(PAGE_IDS.ressources, { title: "Ressources numériques", parentId: ROOT, icon: "🧰" }),
    row(PAGE_IDS.todo, { title: "To Do", parentId: ROOT, icon: "🚧" }),
    base(BASE_IDS.bots, "Bot's"),
    base(BASE_IDS.tice, "Exemples TICE"),
    base(BASE_IDS.prompts, "Prompts"),
    base(BASE_IDS.ressources, "Ressources numériques"),
    base(BASE_IDS.todo, "To Do", { liveEntries: 161 }),
    base(BASE_IDS.todoDup, "To Do", { liveEntries: 0, manualOrder: "a1" }),
    base(BASE_IDS.inbox, "Vide-cerveau", { isInbox: true }),
    base(BASE_IDS.vibe, "Exemples vibe coding"),
    base(BASE_IDS.prompting, "Formation prompting"),
    base(BASE_IDS.philippe, "Philippe VI"),
    base(BASE_IDS.virements, "Virements récurents"),
  ];
}

// Applique le plan aux lignes, pour éprouver le second passage.
function applied(rows: readonly ConvertRow[]) {
  const plan = planBasesPage(rows);
  const trashed = new Set([...plan.trashPageIds, ...plan.duplicates]);
  const out = rows.map((input) => {
    if (trashed.has(input.id)) return { ...input, trashed: true };
    if (input.id === plan.rootId) {
      return { ...input, body: plan.page.body, isBasesRoot: plan.page.roleChanged ? true : input.isBasesRoot };
    }
    if (plan.oldRootId && input.id === plan.oldRootId) return { ...input, isBasesRoot: false, trashed: true };
    const patch = plan.bases.get(input.id);
    return patch
      ? {
          ...input,
          parentId: patch.parentId ?? input.parentId,
          icon: patch.icon !== undefined ? patch.icon : input.icon,
          cover: patch.cover !== undefined ? patch.cover : input.cover,
          coverPosition: patch.coverPosition !== undefined ? patch.coverPosition : input.coverPosition,
        }
      : input;
  });
  return { plan, out };
}

describe("planBasesPage", () => {
  it("annonce les cinq transferts, dix déplacements, un doublon, les conversions et les cinq corbeilles", () => {
    const plan = planBasesPage(fixture());
    expect(plan.report).toEqual({
      transfers: 5,
      moves: 10,
      duplicates: 1,
      embedded: 4,
      replaced: 1,
      added: 4,
      trashedPages: 5,
      roleChanged: true,
    });
  });

  it("reprend emoji et bandeau des pages vides, en gardant la base To Do vivante", () => {
    const plan = planBasesPage(fixture());
    expect(plan.bases.get(BASE_IDS.todo)?.icon).toBe("🚧");
    expect(plan.bases.get(BASE_IDS.tice)?.cover).toBe("up_cover.jpg");
    expect(plan.bases.get(BASE_IDS.tice)?.coverPosition).toBe(30);
    expect(plan.bases.get(BASE_IDS.todoDup)).toEqual({ trash: true });
    expect(plan.duplicates).toEqual([BASE_IDS.todoDup]);
  });

  it("encastre les quatre bases montrées, remplace la sous-page et ajoute les quatre absentes", () => {
    const plan = planBasesPage(fixture());
    const body = plan.page.body as { type: string; props: Record<string, unknown> }[];
    const embeds = body.filter((block) => block.type === "linked" && block.props.embed === true);
    expect(embeds).toHaveLength(9);
    expect(body.some((block) => block.type === "subpage")).toBe(false);
    // Les quatre ajouts arrivent à la fin, dans l'ordre des titres.
    expect(body.slice(-4).map((block) => block.props.databaseId)).toEqual([
      BASE_IDS.vibe,
      BASE_IDS.prompting,
      BASE_IDS.philippe,
      BASE_IDS.virements,
    ]);
    // Le Vide-cerveau reste sans bloc encastré.
    expect(embeds.some((block) => block.props.databaseId === BASE_IDS.inbox)).toBe(false);
  });

  it("retire le rôle à l'ancien dossier et le pose sur la page", () => {
    const plan = planBasesPage(fixture());
    expect(plan.oldRootId).toBe(OLD);
    expect(plan.page.roleChanged).toBe(true);
    expect(plan.trashPageIds).toEqual([PAGE_IDS.bots, PAGE_IDS.tice, PAGE_IDS.prompts, PAGE_IDS.ressources, PAGE_IDS.todo]);
  });

  it("est idempotent : un second passage ne change rien", () => {
    const { out } = applied(fixture());
    const second = planBasesPage(out);
    expect(second.report).toEqual({
      transfers: 0,
      moves: 0,
      duplicates: 0,
      embedded: 0,
      replaced: 0,
      added: 0,
      trashedPages: 0,
      roleChanged: false,
    });
    expect(second.page.bodyChanged).toBe(false);
    expect(second.oldRootId).toBeNull();
  });

  it("refuse de vider un ancien dossier encore habité", () => {
    const rows = fixture();
    rows.push(row("pg_dossier_oublie", { title: "Dossier oublié", type: "folder", parentId: OLD }));
    expect(() => planBasesPage(rows)).toThrow(ConversionError);
  });

  it("reconnaît les pages vides quelle que soit l'apostrophe", () => {
    const rows = fixture().map((item) => (item.id === PAGE_IDS.bots ? { ...item, title: "Bot’s" } : item));
    const plan = planBasesPage(rows);
    expect(plan.report.transfers).toBe(5);
    expect(EMPTY_PAGE_TITLES).toContain("Bot's");
  });

  it("ne touche pas une page homonyme rangée ailleurs", () => {
    const rows = fixture();
    rows.push(row("pg_page_ressources_ailleurs", { title: "Ressources numériques", parentId: "ressources", icon: "🧰" }));
    const plan = planBasesPage(rows);
    expect(plan.trashPageIds).not.toContain("pg_page_ressources_ailleurs");
    expect(plan.report.trashedPages).toBe(5);
  });
});

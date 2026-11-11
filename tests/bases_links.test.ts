import { describe, expect, it } from "vitest";
import { describeLinksPlan, planBasesLinks, type LinkBase } from "@/lib/bases_links";

const ROOT = "pg_bases_donnees";

const base = (id: string, overrides: Partial<LinkBase> = {}): LinkBase => ({ id, parentId: ROOT, trashed: false, ...overrides });
const linked = (id: string, databaseId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "linked",
  props: { databaseId, config: "", embed: true, ...extra },
  children: [],
});
const paragraph = (id: string, text = "") => ({ id, type: "paragraph", props: {}, content: text ? [{ type: "text", text, styles: {} }] : [], children: [] });

describe("planBasesLinks", () => {
  it("remplace une base encastrée par un bloc de sous-page qui garde son id", () => {
    const plan = planBasesLinks([linked("b1", "db_todo")], ROOT, [base("db_todo")]);
    expect(plan.body).toEqual([{ id: "b1", type: "subpage", props: { pageId: "db_todo", kind: "database", link: false }, children: [] }]);
    expect(plan.owners).toBe(1);
    expect(plan.links).toBe(0);
    expect(plan.changed).toBe(true);
  });

  it("convertit aussi une vue liée ordinaire (embed absent)", () => {
    const block = { id: "b1", type: "linked", props: { databaseId: "db_a", config: "{}" }, children: [] };
    const plan = planBasesLinks([block], ROOT, [base("db_a")]);
    expect(plan.body[0]).toMatchObject({ type: "subpage", props: { pageId: "db_a", kind: "database", link: false } });
  });

  it("pose un lien (↗) quand la base vit ailleurs que sous la page, ou qu'elle est en corbeille ou inconnue", () => {
    const plan = planBasesLinks(
      [linked("b1", "db_racine"), linked("b2", "db_jetee"), linked("b3", "db_inconnue")],
      ROOT,
      [base("db_racine", { parentId: null }), base("db_jetee", { trashed: true })],
    );
    expect(plan.body.map((block) => (block as { props: { link: boolean } }).props.link)).toEqual([true, true, true]);
    expect(plan.owners).toBe(0);
    expect(plan.links).toBe(3);
  });

  it("descend dans les colonnes et garde les enfants d'un bloc", () => {
    const child = paragraph("p1", "note");
    const body = [
      {
        id: "cl",
        type: "columnList",
        props: {},
        children: [{ id: "c1", type: "column", props: {}, children: [{ ...linked("b1", "db_a"), children: [child] }] }],
      },
    ];
    const plan = planBasesLinks(body, ROOT, [base("db_a")]);
    const converted = (plan.body[0] as { children: { children: unknown[] }[] }).children[0].children[0];
    expect(converted).toEqual({ id: "b1", type: "subpage", props: { pageId: "db_a", kind: "database", link: false }, children: [child] });
  });

  it("laisse intacts les autres blocs et un bloc lié encore vide", () => {
    const pending = { id: "b0", type: "linked", props: { databaseId: "", config: "" }, children: [] };
    const body = [paragraph("p1", "intro"), pending];
    const plan = planBasesLinks(body, ROOT, []);
    expect(plan.body).toEqual(body);
    expect(plan.changed).toBe(false);
  });

  it("ne trouve plus rien au second passage", () => {
    const first = planBasesLinks([paragraph("p1"), linked("b1", "db_a")], ROOT, [base("db_a")]);
    const second = planBasesLinks(first.body, ROOT, [base("db_a")]);
    expect(second.changed).toBe(false);
    expect(second.body).toEqual(first.body);
  });

  it("met à jour le texte de recherche du corps", () => {
    const plan = planBasesLinks([paragraph("p1", "intro"), linked("b1", "db_a")], ROOT, [base("db_a")]);
    expect(plan.bodyText).toBe("intro");
  });

  it("résume le plan en une ligne", () => {
    const plan = planBasesLinks([linked("b1", "db_a"), linked("b2", "db_b")], ROOT, [base("db_a"), base("db_b", { parentId: null })]);
    expect(describeLinksPlan(plan)).toBe("2 bases passées en lien (1 sous-page, 1 lien vers une base rangée ailleurs).");
  });
});

import { describe, expect, it } from "vitest";
import { BASES_ROOT_ID } from "@/lib/bases";
import { planBasesMove, type MoveRow } from "@/lib/bases_move";

// La racine est une page sous « Ressources » (étape 17) : elle est la cible du
// déménagement, jamais un id fixe.
const root: MoveRow = { id: BASES_ROOT_ID, type: "page", parentId: "Ressources", body: [], trashed: false, title: "Bases de données" };
const target = { target: BASES_ROOT_ID };
const subpage = (id: string, pageId: string, link = false) => ({ id, type: "subpage", props: { pageId, ...(link ? { link: true } : {}) }, children: [] });
const paragraph = (id: string) => ({ id, type: "paragraph", props: {}, content: [], children: [] });
const linked = (id: string, databaseId: string) => ({ id, type: "linked", props: { databaseId, config: "" }, children: [] });

const page = (id: string, body: unknown[] = [], extra: Partial<MoveRow> = {}): MoveRow => ({
  id,
  type: "page",
  parentId: null,
  body,
  trashed: false,
  title: id,
  ...extra,
});
const base = (id: string, parentId: string | null, extra: Partial<MoveRow> = {}): MoveRow => ({
  id,
  type: "database",
  parentId,
  body: [],
  trashed: false,
  title: id,
  ...extra,
});

describe("planBasesMove", () => {
  it("convertit le bloc propriétaire en vue liée de même id, à sa place", () => {
    const host = page("veille", [paragraph("p1"), subpage("b1", "ressources"), paragraph("p2")]);
    const plan = planBasesMove([root, host, base("ressources", "veille")], target);
    expect(plan.moved.map((m) => [m.id, m.action])).toEqual([["ressources", "converted"]]);
    expect(plan.bodies.get("veille")).toEqual([paragraph("p1"), linked("b1", "ressources"), paragraph("p2")]);
    expect(plan.report).toEqual({ moved: 1, trashed: 0, converted: 1, added: 0 });
  });

  it("trouve le bloc dans des colonnes", () => {
    const host = page("veille", [{ id: "cl", type: "columnList", props: {}, children: [{ id: "c1", type: "column", props: {}, children: [subpage("b1", "r")] }] }]);
    const plan = planBasesMove([root, host, base("r", "veille")], target);
    const column = (plan.bodies.get("veille") as { children: { children: unknown[] }[] }[])[0].children[0];
    expect(column.children).toEqual([linked("b1", "r")]);
  });

  it("laisse un lien ↗ intact et ajoute la vue liée en fin de page", () => {
    const host = page("veille", [subpage("l1", "r", true)]);
    const plan = planBasesMove([root, host, base("r", "veille")], target);
    expect(plan.bodies.get("veille")).toEqual([subpage("l1", "r", true), linked("linked-r", "r")]);
    expect(plan.moved[0].action).toBe("added");
  });

  it("n'ajoute rien quand la page montre déjà la base par une vue liée (import HTML)", () => {
    const host = page("veille", [linked("v1", "r")]);
    const plan = planBasesMove([root, host, base("r", "veille")], target);
    expect(plan.bodies.size).toBe(0);
    expect(plan.moved[0].action).toBe("none");
  });

  it("range une base en corbeille sans lui ajouter de vue liée", () => {
    const host = page("veille", [paragraph("p1")]);
    const plan = planBasesMove([root, host, base("r", "veille", { trashed: true })], target);
    expect(plan.bodies.size).toBe(0);
    expect(plan.report).toEqual({ moved: 0, trashed: 1, converted: 0, added: 0 });
  });

  it("range une base à la racine de l'arbre, Vide-cerveau compris, sans page hôte", () => {
    const plan = planBasesMove([root, base("zebre", null), base("inbox", null, { isInbox: true, title: "Vide-cerveau" }), base("arbre", null)], target);
    expect(plan.moved.map((m) => m.id)).toEqual(["inbox", "arbre", "zebre"]);
    expect(plan.moved.every((m) => m.hostId === null && m.action === "none")).toBe(true);
  });

  it("accumule les conversions de plusieurs bases sur la même page", () => {
    const host = page("veille", [subpage("b1", "a"), subpage("b2", "b")]);
    const plan = planBasesMove([root, host, base("a", "veille"), base("b", "veille")], target);
    expect(plan.bodies.get("veille")).toEqual([linked("b1", "a"), linked("b2", "b")]);
  });

  it("est idempotent : un second passage ne trouve rien", () => {
    const host = page("veille", [subpage("b1", "r")]);
    const first = planBasesMove([root, host, base("r", "veille")], target);
    const after = [root, { ...host, body: first.bodies.get("veille")! }, base("r", BASES_ROOT_ID)];
    const second = planBasesMove(after, target);
    expect(second.moved).toEqual([]);
    expect(second.bodies.size).toBe(0);
  });

  it("laisse une base déjà rangée sous un dossier ou la racine, même hors des lignes fournies", () => {
    const plan = planBasesMove([base("r", "dossier_vif")], { target: BASES_ROOT_ID, isFolder: (id) => id === "dossier_vif" });
    expect(plan.moved).toEqual([]);
    const underRoot = planBasesMove([root, base("r", BASES_ROOT_ID)], target);
    expect(underRoot.moved).toEqual([]);
  });

  it("vise le dossier demandé", () => {
    const plan = planBasesMove([page("p"), base("r", "p")], { target: "import_du_jour" });
    expect(plan.target).toBe("import_du_jour");
    expect(plan.moved).toHaveLength(1);
  });
});

// L'exception To Do (migration 0013) : la base marquée vit à la racine de
// l'arbre. Le déménagement du démarrage la rangeait à chaque déploiement
// (constaté le 2026-11-13 en production).
describe("planBasesMove, exception To Do", () => {
  it("laisse à la racine la base marquée par l'exception", () => {
    const plan = planBasesMove([root, base("todo", null, { rootException: true })], target);
    expect(plan.moved).toEqual([]);
    expect(plan.report.moved).toBe(0);
  });

  it("range quand même la base marquée si elle est sous une page", () => {
    const host = page("accueil", [subpage("b1", "todo")]);
    const plan = planBasesMove([root, host, base("todo", "accueil", { rootException: true })], target);
    expect(plan.moved.map((m) => m.id)).toEqual(["todo"]);
  });

  it("range une base non marquée posée à la racine", () => {
    const plan = planBasesMove([root, base("todo", null, { rootException: true }), base("autre", null)], target);
    expect(plan.moved.map((m) => m.id)).toEqual(["autre"]);
  });
});

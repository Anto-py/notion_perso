import { beforeEach, describe, expect, it } from "vitest";
import { planRecovery, type LiveRef, type SourcePage } from "../src/lib/backup_restore_plan";

let compteur = 0;
const newId = (prefix: string) => `${prefix}_neuf${++compteur}`;

beforeEach(() => {
  compteur = 0;
});

function page(overrides: Partial<SourcePage> & { id: string }): SourcePage {
  return {
    parentId: null,
    type: "page",
    title: "",
    icon: null,
    cover: null,
    coverPosition: null,
    body: [],
    dbConfig: null,
    dbId: null,
    propertyValues: null,
    manualOrder: "a0",
    createdAt: new Date("2026-11-01T09:00:00Z"),
    updatedAt: new Date("2026-11-01T09:00:00Z"),
    ...overrides,
  };
}

function liveRef(overrides: Partial<LiveRef> = {}): LiveRef {
  return { parentId: null, dbId: null, trashed: false, ...overrides };
}

describe("planRecovery", () => {
  it("réécrit une page encore présente sous son id, et copie sa version actuelle en corbeille", () => {
    const plan = planRecovery([page({ id: "pg_a", title: "A" })], new Map([["pg_a", liveRef()]]), newId);
    expect(plan.pages.map((p) => p.id)).toEqual(["pg_a"]);
    expect(plan.copies).toEqual([{ id: "pg_neuf1", sourceId: "pg_a" }]);
    expect(plan.blockedBy).toBeNull();
  });

  it("recrée sous un id neuf une page disparue, sans copie", () => {
    const plan = planRecovery([page({ id: "pg_disparue" })], new Map(), newId);
    expect(plan.pages[0].id).toBe("pg_neuf1");
    expect(plan.copies).toEqual([]);
  });

  it("traite aussi comme présente une page en corbeille dans la base vive", () => {
    const plan = planRecovery(
      [page({ id: "pg_a" })],
      new Map([["pg_a", liveRef({ trashed: true })]]),
      newId,
    );
    expect(plan.pages[0].id).toBe("pg_a");
    expect(plan.copies).toHaveLength(1);
  });

  it("écrit les parents d'abord et réécrit les blocs de sous-page vers les ids neufs", () => {
    const source = [
      page({
        id: "pg_enfant",
        parentId: "pg_parent",
        body: [{ type: "paragraph", props: {}, content: [], children: [] }],
      }),
      page({
        id: "pg_parent",
        body: [{ type: "subpage", props: { pageId: "pg_enfant", kind: "page" }, content: [], children: [] }],
      }),
    ];
    const plan = planRecovery(source, new Map(), newId);
    expect(plan.pages.map((p) => p.id)).toEqual(["pg_neuf1", "pg_neuf2"]);
    const parent = plan.pages[0];
    const child = plan.pages[1];
    expect(child.parentId).toBe(parent.id);
    expect((parent.body as { props: { pageId: string } }[])[0].props.pageId).toBe(child.id);
  });

  it("remonte à la racine quand le parent a disparu et n'est pas repris", () => {
    const plan = planRecovery([page({ id: "pg_a", parentId: "pg_parent_mort" })], new Map(), newId);
    expect(plan.pages[0].parentId).toBeNull();
  });

  it("rattache une page reprise à un parent resté vivant", () => {
    const plan = planRecovery(
      [page({ id: "pg_a", parentId: "pg_parent" })],
      new Map([["pg_parent", liveRef()]]),
      newId,
    );
    expect(plan.pages[0].parentId).toBe("pg_parent");
  });

  it("bloque une entrée dont la base a disparu et n'est pas reprise", () => {
    const plan = planRecovery(
      [page({ id: "pg_entree", type: "entry", dbId: "pg_base_morte" })],
      new Map(),
      newId,
    );
    expect(plan.blockedBy).toBe("pg_base_morte");
    expect(plan.pages[0].dbId).toBeNull();
  });

  it("rattache une entrée à sa base restée vivante", () => {
    const plan = planRecovery(
      [page({ id: "pg_entree", type: "entry", dbId: "pg_base" })],
      new Map([["pg_base", liveRef({ parentId: null })]]),
      newId,
    );
    expect(plan.pages[0].dbId).toBe("pg_base");
    expect(plan.blockedBy).toBeNull();
  });

  it("suit la base reprise dans la même sélection", () => {
    const plan = planRecovery(
      [
        page({ id: "pg_entree", type: "entry", dbId: "pg_base" }),
        page({ id: "pg_base", type: "database", dbConfig: { properties: [], views: [] } }),
      ],
      new Map(),
      newId,
    );
    expect(plan.blockedBy).toBeNull();
    expect(plan.pages.find((p) => p.source.id === "pg_entree")?.dbId).toBe(
      plan.pages.find((p) => p.source.id === "pg_base")?.id,
    );
  });

  it("ramasse les fichiers cités par le corps, l'icône et le bandeau", () => {
    const plan = planRecovery(
      [
        page({
          id: "pg_a",
          icon: "image:up_aaaaaaaaaaaaaaaa.png",
          cover: "image:up_bbbbbbbbbbbbbbbb.jpg",
          body: [{ type: "image", props: { url: "/api/media/up_cccccccccccccccc.png" }, children: [] }],
        }),
      ],
      new Map(),
      newId,
    );
    expect(plan.media.sort()).toEqual([
      "up_aaaaaaaaaaaaaaaa.png",
      "up_bbbbbbbbbbbbbbbb.jpg",
      "up_cccccccccccccccc.png",
    ]);
  });
});

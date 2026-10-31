import { describe, expect, it } from "vitest";
import type { SyncPage } from "@/lib/sync_merge";
import {
  CONFIRMED_DELETION,
  applyOrder,
  canonicalJson,
  decideIncoming,
  isPending,
  latestChanges,
  localPage,
  planPush,
  rowHash,
  type BaseEntry,
  type Candidate,
} from "@/lib/sync_client_plan";
import { SYNC_BATCH, type Change, type SyncMedia } from "@/lib/sync_protocol";

const T0 = "2026-10-31T10:00:00.000Z";

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

function mediaRow(over: Partial<SyncMedia> = {}): SyncMedia {
  return {
    id: "md_1",
    filename: "up_aaaaaaaaaaaaaaaa.png",
    originalName: "schema.png",
    mime: "image/png",
    size: 10,
    pageId: null,
    unusedSince: null,
    createdAt: T0,
    ...over,
  };
}

const base = (row: SyncPage, rev = 5): BaseEntry => ({ kind: "page", id: row.id, rev, hash: rowHash(row), snapshot: row });
const candidate = (row: SyncPage | null, entry: BaseEntry | null, id = row?.id ?? entry!.id): Candidate => ({
  kind: "page",
  id,
  row,
  base: entry,
});

describe("canonicalJson et rowHash", () => {
  it("ignore l'ordre des clés, à toute profondeur", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(rowHash(page({ body: a }))).toBe(rowHash(page({ body: b })));
  });

  it("garde l'ordre des listes, qui porte un sens (ordre des blocs)", () => {
    expect(rowHash(page({ body: [1, 2] }))).not.toBe(rowHash(page({ body: [2, 1] })));
  });

  it("distingue une valeur nulle d'une chaîne vide", () => {
    expect(rowHash(page({ icon: null }))).not.toBe(rowHash(page({ icon: "" })));
  });
});

describe("isPending", () => {
  const row = page();

  it("une ligne identique à sa base n'attend pas, même réécrite", () => {
    expect(isPending(candidate({ ...row }, base(row)))).toBe(false);
  });

  it("modifiée, créée ou effacée sur le Mac : elle attend", () => {
    expect(isPending(candidate({ ...row, title: "Autre" }, base(row)))).toBe(true);
    expect(isPending(candidate(row, null))).toBe(true);
    expect(isPending(candidate(null, base(row)))).toBe(true);
  });
});

describe("planPush", () => {
  it("envoie les parents avant les enfants, puis médias, puis icônes", () => {
    const child = page({ id: "pg_child", parentId: "pg_parent" });
    const parent = page({ id: "pg_parent" });
    const pending: Candidate[] = [
      { kind: "icon_image", id: "ic_1", row: { id: "ic_1", mediaId: "md_1", name: "Logo", hidden: false, createdAt: T0 }, base: null },
      { kind: "media", id: "md_1", row: mediaRow(), base: null },
      candidate(child, null),
      candidate(parent, null),
    ];
    const plan = planPush(pending);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].map((item) => item.id)).toEqual(["pg_parent", "pg_child", "md_1", "ic_1"]);
  });

  it("joint la base commune et sa révision, nulles pour une création", () => {
    const old = page();
    const plan = planPush([candidate({ ...old, title: "Neuf" }, base(old, 7)), candidate(page({ id: "pg_new" }), null)]);
    const [first, second] = plan.batches[0];
    expect(first).toMatchObject({ kind: "page", baseRev: 7, base: old });
    expect(second).toMatchObject({ kind: "page", baseRev: null, base: null });
  });

  it("un média part sans base : le serveur ne fait que l'ajouter", () => {
    const plan = planPush([{ kind: "media", id: "md_1", row: mediaRow(), base: null }]);
    expect(plan.batches[0][0]).toEqual({ kind: "media", id: "md_1", row: mediaRow() });
  });

  it("suppressions : icônes, entrées, pages, bases, médias en dernier", () => {
    const gone = (kind: Candidate["kind"], id: string, type?: SyncPage["type"]): Candidate => ({
      kind,
      id,
      row: null,
      base: { kind, id, rev: 3, hash: "h", snapshot: kind === "page" ? page({ id, type, dbId: type === "entry" ? "db" : null }) : mediaRow({ id }) },
    });
    const plan = planPush([
      gone("media", "md_1"),
      gone("page", "db", "database"),
      gone("page", "pg_1", "page"),
      gone("page", "en_1", "entry"),
      gone("icon_image", "ic_1"),
    ]);
    expect(plan.batches[0].map((item) => item.id)).toEqual(["ic_1", "en_1", "pg_1", "db", "md_1"]);
    expect(plan.batches[0][0]).toEqual({ kind: "icon_image", id: "ic_1", baseRev: 3, deleted: true });
  });

  it("retient l'empreinte de ce qui part, null pour une suppression", () => {
    const row = page({ title: "Neuf" });
    const plan = planPush([candidate(row, null), candidate(null, base(page({ id: "pg_gone" })), "pg_gone")]);
    expect(plan.sent.get("page:pg_1")).toBe(rowHash(row));
    expect(plan.sent.get("page:pg_gone")).toBeNull();
  });

  it("découpe en lots de SYNC_BATCH lignes", () => {
    const many = Array.from({ length: SYNC_BATCH + 1 }, (_, i) => candidate(page({ id: `pg_${i}` }), null));
    expect(planPush(many).batches.map((batch) => batch.length)).toEqual([SYNC_BATCH, 1]);
  });
});

describe("latestChanges", () => {
  it("garde la version la plus récente d'une ligne relue", () => {
    const changes: Change[] = [
      { kind: "page", id: "pg_1", rev: 10, row: page({ title: "Vieux" }) },
      { kind: "page", id: "pg_1", rev: 12, row: page({ title: "Récent" }) },
      { kind: "page", id: "pg_1", rev: 11, row: page({ title: "Milieu" }) },
    ];
    const latest = latestChanges(changes).get("page:pg_1") as Extract<Change, { row: SyncPage }>;
    expect(latest.row.title).toBe("Récent");
  });

  it("une suppression confirmée par le serveur l'emporte sur une version lue", () => {
    const changes: Change[] = [
      { kind: "page", id: "pg_1", rev: CONFIRMED_DELETION, deleted: true },
      { kind: "page", id: "pg_1", rev: 40, row: page() },
    ];
    expect(latestChanges(changes).get("page:pg_1")).toMatchObject({ deleted: true });
  });
});

describe("decideIncoming", () => {
  const row = page();
  const entry = base(row, 5);
  const incoming: Change = { kind: "page", id: "pg_1", rev: 9, row: page({ title: "Du web" }) };

  it("ligne locale intacte depuis sa base : on écrit", () => {
    expect(decideIncoming(incoming, entry.hash, entry, undefined)).toBe("apply");
  });

  it("ligne modifiée sur le Mac : on la garde pour la fusion du cycle suivant", () => {
    expect(decideIncoming(incoming, rowHash(page({ title: "Du Mac" })), entry, undefined)).toBe("keep");
  });

  it("ligne inconnue des deux côtés : on écrit", () => {
    expect(decideIncoming(incoming, null, null, undefined)).toBe("apply");
  });

  it("révision déjà reçue : rien à écrire", () => {
    expect(decideIncoming({ ...incoming, rev: 5 }, entry.hash, entry, undefined)).toBe("same");
  });

  it("réponse à un envoi : on écrit si la ligne n'a pas bougé depuis l'envoi", () => {
    const sent = rowHash(page({ title: "Du Mac" }));
    expect(decideIncoming(incoming, sent, entry, sent)).toBe("apply");
    expect(decideIncoming(incoming, rowHash(page({ title: "Du Mac, suite" })), entry, sent)).toBe("keep");
  });

  it("suppression envoyée : la version renvoyée (corbeille) se réécrit si la ligne est toujours absente", () => {
    expect(decideIncoming(incoming, null, entry, null)).toBe("apply");
  });
});

describe("applyOrder", () => {
  it("pages parent d'abord, puis médias et icônes, suppressions à part", () => {
    const changes: Change[] = [
      { kind: "page", id: "en_1", rev: 3, row: page({ id: "en_1", type: "entry", dbId: "db_1" }) },
      { kind: "media", id: "md_1", rev: 4, row: mediaRow() },
      { kind: "page", id: "db_1", rev: 5, row: page({ id: "db_1", type: "database" }) },
      { kind: "page", id: "pg_x", rev: 6, deleted: true },
      { kind: "icon_image", id: "ic_1", rev: 7, deleted: true },
    ];
    const order = applyOrder(changes);
    expect(order.pages.map((p) => p.id)).toEqual(["db_1", "en_1"]);
    expect(order.media.map((m) => m.id)).toEqual(["md_1"]);
    expect(order.deletions).toEqual([
      { kind: "icon_image", id: "ic_1" },
      { kind: "page", id: "pg_x" },
    ]);
  });
});

describe("localPage", () => {
  const exists = (id: string) => id === "pg_here" || id === "db_here";

  it("garde une page dont les cibles existent", () => {
    const row = page({ parentId: "pg_here" });
    expect(localPage(row, exists)).toBe(row);
  });

  it("range à la racine une page dont le parent manque", () => {
    expect(localPage(page({ parentId: "pg_gone" }), exists)?.parentId).toBeNull();
  });

  it("n'écrit pas une entrée dont la base manque", () => {
    expect(localPage(page({ type: "entry", dbId: "db_gone" }), exists)).toBeNull();
  });
});

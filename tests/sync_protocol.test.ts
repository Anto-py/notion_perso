import { describe, expect, it } from "vitest";
import type { SyncPage } from "@/lib/sync_merge";
import {
  SYNC_BATCH,
  decideDeletion,
  decideIconImage,
  decidePage,
  pageToSync,
  parsePush,
  readAfter,
  readCursor,
  versionGap,
  writeOrder,
  type SyncIconImage,
} from "@/lib/sync_protocol";

const T0 = "2026-10-31T10:00:00.000Z";
const T_MAC = "2026-10-31T11:00:00.000Z";
const T_WEB = "2026-10-31T12:00:00.000Z";
const NOW = "2026-10-31T15:00:00.000Z";

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

const icon = (over: Partial<SyncIconImage> = {}): SyncIconImage => ({
  id: "ic_1",
  mediaId: "up_1",
  name: "Logo",
  hidden: false,
  createdAt: T0,
  ...over,
});

const pushPage = (row: SyncPage, baseRev: number | null = null, base: SyncPage | null = null) => ({
  kind: "page" as const,
  id: row.id,
  baseRev,
  base,
  row,
});

describe("pageToSync", () => {
  it("rend les dates en ISO et écarte les champs dérivés et les révisions", () => {
    const created = new Date(T0);
    const row = {
      ...page(),
      createdAt: created,
      updatedAt: new Date(T_WEB),
      trashedAt: null,
      bodyText: "texte",
      valuesText: "valeurs",
      searchVector: "'vec'",
      rev: 42,
      syncXid: "7",
    };
    const sync = pageToSync(row);
    expect(sync).toEqual(page({ updatedAt: T_WEB }));
    expect(sync).not.toHaveProperty("bodyText");
    expect(sync).not.toHaveProperty("rev");
  });
});

describe("parsePush", () => {
  it("lit une page, une suppression, un média et une image d'icône", () => {
    const items = parsePush({
      items: [
        pushPage(page(), 3, page()),
        { kind: "page", id: "pg_2", baseRev: 5, deleted: true },
        {
          kind: "media",
          id: "up_a",
          row: { id: "up_a", filename: "up_abcdefghijklmnop.png", originalName: "a.png", mime: "image/png", size: 10, pageId: "pg_1", unusedSince: null, createdAt: T0 },
        },
        { kind: "icon_image", id: "ic_1", baseRev: null, base: null, row: icon() },
      ],
    });
    expect(Array.isArray(items) && items.map((item) => item.kind)).toEqual(["page", "page", "media", "icon_image"]);
  });

  it("ne garde que les champs connus d'une ligne", () => {
    const items = parsePush({ items: [pushPage({ ...page(), bodyText: "injecté" } as SyncPage)] });
    expect(Array.isArray(items) && items[0]).not.toHaveProperty("row.bodyText");
  });

  it("refuse un champ mal formé en le nommant", () => {
    expect(parsePush({ items: [pushPage(page({ manualOrder: "!!" }))] })).toBe("page pg_1 : champ manualOrder");
    expect(parsePush({ items: [pushPage(page({ type: "entry" }))] })).toBe("page pg_1 : champ dbId");
    expect(parsePush({ items: [pushPage(page({ dbId: "pg_db" }))] })).toBe("page pg_1 : champ dbId");
    expect(parsePush({ items: [pushPage(page({ updatedAt: "hier" }))] })).toBe("page pg_1 : champ updatedAt");
  });

  it("refuse un nom de média hors du dossier des dépôts", () => {
    const row = { id: "up_a", filename: "../.env", originalName: "a", mime: "image/png", size: 1, pageId: null, unusedSince: null, createdAt: T0 };
    expect(parsePush({ items: [{ kind: "media", id: "up_a", row }] })).toBe("media up_a : champ filename");
  });

  it("refuse une suppression sans révision de base", () => {
    expect(parsePush({ items: [{ kind: "page", id: "pg_2", deleted: true }] })).toMatch(/baseRev attendue/);
  });

  it("refuse un id de ligne qui diffère de celui de l'élément", () => {
    expect(parsePush({ items: [{ ...pushPage(page()), id: "pg_9" }] })).toMatch(/id de la ligne différent/);
  });

  it("refuse une ligne envoyée deux fois et un lot trop gros", () => {
    expect(parsePush({ items: [pushPage(page()), pushPage(page())] })).toMatch(/deux fois/);
    const many = Array.from({ length: SYNC_BATCH + 1 }, (_, i) => pushPage(page({ id: `pg_${i}` })));
    expect(parsePush({ items: many })).toMatch(/Au plus/);
    expect(parsePush([])).toMatch(/Corps attendu/);
  });
});

describe("curseur et révision", () => {
  it("lit un xid en chiffres, 0 par défaut", () => {
    expect(readCursor(null)).toBe("0");
    expect(readCursor("123456789012")).toBe("123456789012");
    expect(readCursor("12; DROP")).toBeNull();
    expect(readAfter(null)).toBe(0);
    expect(readAfter("-1")).toBeNull();
    expect(readAfter("1.5")).toBeNull();
  });
});

describe("versionGap", () => {
  const server = { schema: 1793457222214, commit: "abcdef1234" };

  it("laisse passer le même schéma et le même commit", () => {
    expect(versionGap(server, { schema: "1793457222214", commit: "abcdef1234" })).toBeNull();
  });

  it("ne bloque pas sur un commit inconnu d'un côté", () => {
    expect(versionGap(server, { schema: "1793457222214", commit: null })).toBeNull();
    expect(versionGap({ ...server, commit: null }, { schema: "1793457222214", commit: "zzz" })).toBeNull();
  });

  it("dit lequel des deux est en retard", () => {
    expect(versionGap(server, { schema: "1", commit: null })).toMatch(/Redémarrez l'app Mac/);
    expect(versionGap(server, { schema: "1893457222214", commit: null })).toMatch(/déployez-le/);
    expect(versionGap(server, { schema: "1793457222214", commit: "0000000" })).toMatch(/Code différent \(serveur abcdef1, Mac 0000000\)/);
    expect(versionGap(server, { schema: null, commit: null })).toMatch(/X-Sync-Schema/);
  });
});

describe("decidePage", () => {
  it("insère une page créée sur le Mac", () => {
    const decision = decidePage(pushPage(page({ title: "Neuve" })), null, false, NOW);
    expect(decision).toEqual({ row: page({ title: "Neuve" }), conflicts: 0, revived: false });
  });

  it("fait revenir en corbeille une page purgée sur le serveur", () => {
    const decision = decidePage(pushPage(page({ title: "Modifiée" }), 3, page()), null, true, NOW);
    expect(decision.revived).toBe(true);
    expect(decision.row.title).toBe("Modifiée");
    expect(decision.row.trashedAt).toBe(NOW);
  });

  it("prend la version du Mac quand le serveur n'a pas bougé", () => {
    const mac = page({ title: "Mac", updatedAt: T_MAC });
    const server = { rev: 3, row: page({ title: "Veille" }) };
    expect(decidePage(pushPage(mac, 3, page()), server, false, NOW).row).toEqual(mac);
  });

  it("fusionne quand le serveur a bougé depuis la base", () => {
    const base = page({ icon: null, title: "Veille" });
    const mac = page({ title: "Titre du Mac", updatedAt: T_MAC });
    const web = page({ icon: "📚", updatedAt: T_WEB });
    const decision = decidePage(pushPage(mac, 3, base), { rev: 8, row: web }, false, NOW);
    expect(decision.row.title).toBe("Titre du Mac");
    expect(decision.row.icon).toBe("📚");
  });

  it("rend sans effet un envoi rejoué après une réponse perdue", () => {
    const mac = page({ title: "Mac", updatedAt: T_MAC });
    // Le serveur a déjà appliqué la version du Mac, sous une révision neuve.
    const decision = decidePage(pushPage(mac, 3, page()), { rev: 9, row: mac }, false, NOW);
    expect(decision).toEqual({ row: mac, conflicts: 0, revived: false });
  });
});

describe("decideDeletion", () => {
  it("efface ce que le serveur n'a pas touché, garde en corbeille le reste", () => {
    expect(decideDeletion(5, null)).toBe("gone");
    expect(decideDeletion(5, { rev: 5 })).toBe("delete");
    expect(decideDeletion(5, { rev: 7 })).toBe("trash");
  });
});

describe("decideIconImage", () => {
  const item = (row: SyncIconImage, baseRev: number | null, base: SyncIconImage | null) => ({
    kind: "icon_image" as const,
    id: row.id,
    baseRev,
    base,
    row,
  });

  it("prend la version du Mac quand le serveur n'a pas bougé ou n'a rien", () => {
    expect(decideIconImage(item(icon({ name: "Mac" }), 2, icon()), { rev: 2, row: icon() }).name).toBe("Mac");
    expect(decideIconImage(item(icon({ name: "Mac" }), null, null), null).name).toBe("Mac");
  });

  it("fusionne champ par champ, le serveur gardant un champ changé des deux côtés", () => {
    const merged = decideIconImage(item(icon({ name: "Mac", hidden: true }), 2, icon()), { rev: 5, row: icon({ name: "Web" }) });
    expect(merged).toEqual(icon({ name: "Web", hidden: true }));
  });
});

describe("writeOrder", () => {
  it("écrit une base avant ses entrées et un parent avant ses enfants", () => {
    const entry = page({ id: "en", type: "entry", dbId: "db" });
    const child = page({ id: "child", parentId: "parent" });
    const parent = page({ id: "parent" });
    const database = page({ id: "db", type: "database", parentId: "parent" });
    const order = writeOrder([entry, child, database, parent]).map((row) => row.id);
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("en"));
    expect(order.indexOf("parent")).toBeLessThan(order.indexOf("child"));
    expect(order.indexOf("parent")).toBeLessThan(order.indexOf("db"));
    expect(order).toHaveLength(4);
  });

  it("garde toutes les lignes d'une boucle", () => {
    const a = page({ id: "a", parentId: "b" });
    const b = page({ id: "b", parentId: "a" });
    expect(writeOrder([a, b]).map((row) => row.id).sort()).toEqual(["a", "b"]);
  });
});

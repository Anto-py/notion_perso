import { describe, expect, it } from "vitest";
import { FIRST_KEY, isOrderKey, keyBetween, keyFromIndex, keysBetween, rekey } from "@/lib/order_key";

const sorted = (keys: string[]) => keys.every((key, i) => i === 0 || keys[i - 1] < key);

describe("keyBetween", () => {
  it("liste vide, début, fin", () => {
    expect(keyBetween(null, null)).toBe(FIRST_KEY);
    expect(keyBetween(FIRST_KEY, null)).toBe("a1");
    expect(keyBetween(null, FIRST_KEY)).toBe("Zz");
    expect(keyBetween("az", null)).toBe("b00");
  });

  it("entre deux clés voisines, une partie fractionnaire apparaît", () => {
    const key = keyBetween("a0", "a1");
    expect(["a0" < key, key < "a1", key]).toEqual([true, true, "a0V"]);
  });

  it("refuse des bornes inversées ou invalides", () => {
    expect(() => keyBetween("a1", "a0")).toThrow();
    expect(() => keyBetween("a1", "a1")).toThrow();
    expect(() => keyBetween("a10", null)).toThrow();
    expect(() => keyBetween("é", null)).toThrow();
  });

  // Pire cas : chaque insertion coupe l'intervalle en deux, soit un caractère
  // de plus toutes les six (log2 62).
  it("mille insertions toujours au même endroit restent triées", () => {
    let low = "a0";
    const high = "a1";
    for (let i = 0; i < 1000; i++) {
      const key = keyBetween(low, high);
      expect(low < key && key < high).toBe(true);
      low = key;
    }
    expect(low.length).toBeLessThan(1000 / 4.5);
  });

  it("dix mille ajouts en fin : clés de quatre caractères au plus", () => {
    let key = FIRST_KEY;
    for (let i = 0; i < 10000; i++) key = keyBetween(key, null);
    expect(key.length).toBeLessThanOrEqual(4);
  });

  it("des insertions alternées en tête restent triées", () => {
    const keys = [FIRST_KEY];
    for (let i = 0; i < 300; i++) keys.unshift(keyBetween(null, keys[0]));
    expect(sorted(keys)).toBe(true);
    expect(keys.every(isOrderKey)).toBe(true);
  });
});

describe("keysBetween", () => {
  it("n clés croissantes entre deux bornes, ouvertes ou non", () => {
    for (const [a, b] of [[null, null], ["a0", null], [null, "a5"], ["a0", "a1"]] as const) {
      const keys = keysBetween(a, b, 50);
      expect(keys).toHaveLength(50);
      expect(sorted([...(a ? [a] : []), ...keys, ...(b ? [b] : [])])).toBe(true);
    }
  });
});

describe("keyFromIndex", () => {
  it("égale n ajouts en fin depuis la première clé", () => {
    let key = FIRST_KEY;
    for (let n = 0; n < 5000; n++) {
      expect(keyFromIndex(n)).toBe(key);
      key = keyBetween(key, null);
    }
  });

  it("refuse un rang négatif ou fractionnaire", () => {
    expect(() => keyFromIndex(-1)).toThrow();
    expect(() => keyFromIndex(1.5)).toThrow();
  });
});

describe("rekey", () => {
  const apply = (order: string[], current: Map<string, string>) => {
    const changes = rekey(order, current);
    const after = new Map([...current, ...changes]);
    return { changes, keys: order.map((id) => after.get(id)!) };
  };
  const keyed = (ids: string[]) => new Map(ids.map((id, i) => [id, keyFromIndex(i)]));

  it("une carte glissée : une seule clé écrite", () => {
    const current = keyed(["a", "b", "c", "d", "e"]);
    const { changes, keys } = apply(["a", "d", "b", "c", "e"], current);
    expect([...changes.keys()]).toEqual(["d"]);
    expect(sorted(keys)).toBe(true);
  });

  it("carte glissée en tête ou en fin", () => {
    const current = keyed(["a", "b", "c"]);
    expect([...apply(["c", "a", "b"], current).changes.keys()]).toEqual(["c"]);
    expect([...apply(["b", "c", "a"], current).changes.keys()]).toEqual(["a"]);
  });

  it("ordre inchangé : rien à écrire", () => {
    expect(rekey(["a", "b", "c"], keyed(["a", "b", "c"])).size).toBe(0);
  });

  it("clés égales (lignes jamais ordonnées) : réécrites dans l'ordre voulu", () => {
    const current = new Map([["a", FIRST_KEY], ["b", FIRST_KEY], ["c", FIRST_KEY]]);
    const { changes, keys } = apply(["c", "b", "a"], current);
    expect(changes.size).toBe(2);
    expect(sorted(keys)).toBe(true);
  });

  it("clé absente ou invalide : réécrite", () => {
    const current = new Map([["a", "a0"], ["b", "a10"]]);
    const { changes, keys } = apply(["a", "b", "c"], current);
    expect([...changes.keys()].sort()).toEqual(["b", "c"]);
    expect(sorted(keys)).toBe(true);
  });

  it("ordre inversé : la moitié au moins reste en place", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `e${i}`);
    const current = keyed(ids);
    const { changes, keys } = apply([...ids].reverse(), current);
    expect(changes.size).toBe(39);
    expect(sorted(keys)).toBe(true);
  });
});

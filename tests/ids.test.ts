import { describe, expect, it } from "vitest";
import { newId, newToken } from "@/lib/ids";

describe("ids", () => {
  it("préfixe l'identifiant et le rend sûr dans une URL", () => {
    expect(newId("pg")).toMatch(/^pg_[A-Za-z0-9_-]{16}$/);
  });

  it("ne répète pas un jeton", () => {
    const tokens = new Set(Array.from({ length: 1000 }, newToken));
    expect(tokens.size).toBe(1000);
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

import { describe, expect, it } from "vitest";
import { canAccess } from "@/lib/access";

describe("access (v1, compte unique)", () => {
  const page = { id: "pg_x" };

  it("autorise tout utilisateur connecté, en lecture comme en écriture", () => {
    expect(canAccess({ id: "us_1" }, page, "read")).toBe(true);
    expect(canAccess({ id: "us_1" }, page, "write")).toBe(true);
  });

  it("refuse sans utilisateur", () => {
    expect(canAccess(null, page, "read")).toBe(false);
  });
});

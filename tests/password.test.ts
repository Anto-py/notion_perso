import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password", () => {
  it("accepte le bon mot de passe et refuse un autre", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterie", hash)).toBe(false);
  });

  it("sale chaque hash : deux hachages du même mot de passe diffèrent", async () => {
    const [a, b] = await Promise.all([hashPassword("pareil"), hashPassword("pareil")]);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$131072$8$1$")).toBe(true);
  });

  it("refuse un hash corrompu sans lever d'erreur", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b$c$d$e")).toBe(false);
    expect(await verifyPassword("x", "scrypt$pasunnombre$8$1$c2Vs$aGFzaA")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { redirectTo } from "@/lib/redirect";

describe("redirectTo", () => {
  it("garde le chemin relatif, sans hôte ajouté", () => {
    const response = redirectTo("/login?erreur=identifiants");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?erreur=identifiants");
  });

  it("laisse poser un cookie sur la réponse", () => {
    const response = redirectTo("/");
    response.cookies.set("np_session", "jeton");
    expect(response.headers.get("set-cookie")).toContain("np_session=jeton");
  });
});

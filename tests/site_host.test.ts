import { describe, expect, it } from "vitest";
import { siteHost } from "@/lib/site_host";

describe("siteHost", () => {
  it("admet un nom de domaine, mis en minuscules", () => {
    expect(siteHost("MindMup.com")).toBe("mindmup.com");
    expect(siteHost("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
  });

  it("refuse ce qui n'est pas un nom de domaine à point", () => {
    for (const raw of ["", "localhost", "../etc/passwd", "a/b.com", "exemple..org", "-x.org", "x-.org", "127.0.0.1:80", "[::1]", "x.org.", "é.org"]) {
      expect(siteHost(raw), raw).toBeNull();
    }
    expect(siteHost(`${"a".repeat(250)}.org`)).toBeNull();
  });
});

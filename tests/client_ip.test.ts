import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client_ip";

const withForwarded = (value?: string) => ({ headers: new Headers(value === undefined ? {} : { "x-forwarded-for": value }) });

describe("clientIp", () => {
  it("prend la dernière entrée, celle que pose le proxy", () => {
    expect(clientIp(withForwarded("6.6.6.6, 10.0.0.1, 203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIp(withForwarded(" 203.0.113.7 "))).toBe("203.0.113.7");
  });

  it("retombe sur « local » sans en-tête ou avec une dernière entrée vide", () => {
    expect(clientIp(withForwarded())).toBe("local");
    expect(clientIp(withForwarded("203.0.113.7, "))).toBe("local");
  });
});

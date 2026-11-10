import { describe, expect, it } from "vitest";
import { createRateLimit } from "@/lib/rate_limit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimit", () => {
  it("laisse passer jusqu'à la limite, refuse au-delà avec le temps restant", () => {
    const c = clock(1_000);
    const limit = createRateLimit({ limit: 3, windowMs: 60_000, now: c.now });
    expect(limit.take("ip")).toEqual({ ok: true, retryAfter: 0 });
    c.advance(10_000);
    expect(limit.take("ip").ok).toBe(true);
    expect(limit.take("ip").ok).toBe(true);
    expect(limit.take("ip")).toEqual({ ok: false, retryAfter: 50_000 });
  });

  it("rouvre à la fin de la fenêtre", () => {
    const c = clock();
    const limit = createRateLimit({ limit: 1, windowMs: 1_000, now: c.now });
    expect(limit.take("ip").ok).toBe(true);
    c.advance(999);
    expect(limit.take("ip")).toEqual({ ok: false, retryAfter: 1 });
    c.advance(1);
    expect(limit.take("ip")).toEqual({ ok: true, retryAfter: 0 });
  });

  it("compte chaque clé à part", () => {
    const c = clock();
    const limit = createRateLimit({ limit: 1, windowMs: 1_000, now: c.now });
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("b").ok).toBe(true);
    expect(limit.take("a").ok).toBe(false);
  });

  it("une requête refusée ne prolonge pas l'attente", () => {
    const c = clock();
    const limit = createRateLimit({ limit: 1, windowMs: 1_000, now: c.now });
    limit.take("ip");
    c.advance(500);
    limit.take("ip");
    limit.take("ip");
    expect(limit.take("ip").retryAfter).toBe(500);
  });

  it("oublie les clés expirées quand elles dépassent le plafond", () => {
    const c = clock();
    const limit = createRateLimit({ limit: 1, windowMs: 1_000, now: c.now, maxKeys: 2 });
    limit.take("a");
    limit.take("b");
    c.advance(1_000);
    limit.take("c");
    expect(limit.size()).toBe(1);
  });
});

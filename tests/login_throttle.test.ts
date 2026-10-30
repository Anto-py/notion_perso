import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "@/lib/login_throttle";

function setup() {
  let t = 1_000_000;
  const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, now: () => t });
  return { throttle, advance: (ms: number) => (t += ms) };
}

describe("login_throttle", () => {
  it("laisse passer sous le seuil, bloque au seuil", () => {
    const { throttle } = setup();
    throttle.recordFailure("ip");
    throttle.recordFailure("ip");
    expect(throttle.retryAfter("ip")).toBe(0);
    throttle.recordFailure("ip");
    expect(throttle.retryAfter("ip")).toBe(60_000);
  });

  it("débloque quand le plus ancien échec sort de la fenêtre", () => {
    const { throttle, advance } = setup();
    throttle.recordFailure("ip");
    advance(10_000);
    throttle.recordFailure("ip");
    throttle.recordFailure("ip");
    expect(throttle.retryAfter("ip")).toBe(50_000);
    advance(50_000);
    expect(throttle.retryAfter("ip")).toBe(0);
  });

  it("isole les clés et remet à zéro après un succès", () => {
    const { throttle } = setup();
    for (let i = 0; i < 3; i++) throttle.recordFailure("a");
    expect(throttle.retryAfter("b")).toBe(0);
    throttle.reset("a");
    expect(throttle.retryAfter("a")).toBe(0);
  });
});

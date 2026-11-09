import { describe, expect, it } from "vitest";
import { EDGE_SCROLL_BAND, EDGE_SCROLL_MAX, edgeScrollVelocity } from "@/lib/edge_scroll";

describe("edgeScrollVelocity", () => {
  it("ne défile pas loin des bords", () => {
    expect(edgeScrollVelocity(400, 800)).toBe(0);
    expect(edgeScrollVelocity(EDGE_SCROLL_BAND, 800)).toBe(0);
    expect(edgeScrollVelocity(800 - EDGE_SCROLL_BAND, 800)).toBe(0);
  });

  it("défile vers le haut près du bord haut, de plus en plus vite", () => {
    const near = edgeScrollVelocity(EDGE_SCROLL_BAND - 24, 800);
    const edge = edgeScrollVelocity(0, 800);
    expect(near).toBeLessThan(0);
    expect(edge).toBe(-EDGE_SCROLL_MAX);
    expect(Math.abs(edge)).toBeGreaterThan(Math.abs(near));
  });

  it("défile vers le bas près du bord bas, et garde le maximum hors de la vue", () => {
    expect(edgeScrollVelocity(800 - 24, 800)).toBeGreaterThan(0);
    expect(edgeScrollVelocity(800, 800)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollVelocity(1200, 800)).toBe(EDGE_SCROLL_MAX);
  });

  it("accepte une bande et une vitesse propres", () => {
    expect(edgeScrollVelocity(10, 400, 20, 6)).toBe(-3);
    expect(edgeScrollVelocity(200, 400, 20, 6)).toBe(0);
    expect(edgeScrollVelocity(200, 400, 0, 6)).toBe(0);
  });
});

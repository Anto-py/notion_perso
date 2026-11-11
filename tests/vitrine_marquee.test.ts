import { describe, expect, it } from "vitest";
import { MARQUEE_SPEED, marqueeStep } from "@/lib/vitrine_marquee";

describe("marqueeStep", () => {
  it("avance de la vitesse multipliée par le temps écoulé", () => {
    expect(marqueeStep(10, 50, 1000)).toBeCloseTo(10 + MARQUEE_SPEED / 20);
  });

  it("plafonne le temps écoulé (retour d'un onglet en arrière-plan)", () => {
    expect(marqueeStep(0, 60_000, 1000)).toBeCloseTo((MARQUEE_SPEED * 100) / 1000);
  });

  it("ignore un temps négatif", () => {
    expect(marqueeStep(42, -16, 1000)).toBe(42);
  });

  it("revient d'une période au bout du premier jeu de cartes", () => {
    expect(marqueeStep(999, 100, 1000, 20)).toBeCloseTo(1);
  });

  it("ramène dans la période une position poussée loin dans la copie", () => {
    expect(marqueeStep(2500, 0, 1000)).toBeCloseTo(500);
  });

  it("recule avec une vitesse négative et repasse au bout du jeu sous zéro", () => {
    expect(marqueeStep(50, 100, 1000, -100)).toBeCloseTo(40);
    expect(marqueeStep(5, 100, 1000, -100)).toBeCloseTo(995);
  });

  it("ne bouge pas sans période mesurée", () => {
    expect(marqueeStep(7, 100, 0)).toBe(7);
  });
});

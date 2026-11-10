import { describe, expect, it } from "vitest";
import { applyLabelFixes, planLabelFixes, type LabelFix } from "@/lib/vitrine_labels";
import type { SelectOption } from "@/lib/property_schema";

const option = (id: string, name: string): SelectOption => ({ id, name, color: "gray" });

// Les neuf corrections du §14 de BRAINSTORMING.md, telles qu'elles figurent
// aujourd'hui dans la base « Ressources numériques ».
const CORRECTIONS: [string, string][] = [
  ["Fançais", "Français"],
  ["evaluation", "Évaluation"],
  ["differenciation", "Différenciation"],
  ["education aux médias", "Éducation aux médias"],
  ["Quizz / exerciseurs", "Quiz / exerciseurs"],
  ["Cours on line", "Cours en ligne"],
  ["Feed back", "Feedback"],
  ["GPT's", "GPTs"],
  ["micro learning", "Microlearning"],
];

describe("planLabelFixes", () => {
  it("corrige les neuf fautes attestées", () => {
    const fixes = planLabelFixes(CORRECTIONS.map(([name], index) => option(`opt_${index}`, name)));
    expect(fixes.map((fix) => [fix.from, fix.to])).toEqual(CORRECTIONS);
  });

  it("met une majuscule initiale à une étiquette qui commence par une minuscule", () => {
    const fixes = planLabelFixes([option("opt_a", "vidéo"), option("opt_b", "esprit critique"), option("opt_c", "rédaction")]);
    expect(fixes.map((fix) => fix.to)).toEqual(["Vidéo", "Esprit critique", "Rédaction"]);
  });

  it("laisse les sigles en capitales inchangés", () => {
    const options = [option("opt_ia", "IA"), option("opt_llm", "LLM"), option("opt_rag", "RAG"), option("opt_3d", "3D")];
    expect(planLabelFixes(options)).toEqual([]);
  });

  it("remet un sigle tapé en minuscules en capitales", () => {
    expect(planLabelFixes([option("opt_ia", "ia")])).toEqual([{ id: "opt_ia", from: "ia", to: "IA" }]);
  });

  it("ne touche pas une étiquette déjà correcte", () => {
    const options = [option("opt_1", "Collaboration"), option("opt_2", "Accès numérique"), option("opt_3", "ChatGPT")];
    expect(planLabelFixes(options)).toEqual([]);
  });

  it("garde l'ordre des options et ne liste que les corrections", () => {
    const options = [
      option("opt_ia", "IA"),
      option("opt_audio", "audio"),
      option("opt_fr", "Fançais"),
      option("opt_veille", "veille"),
    ];
    expect(planLabelFixes(options)).toEqual([
      { id: "opt_audio", from: "audio", to: "Audio" },
      { id: "opt_fr", from: "Fançais", to: "Français" },
      { id: "opt_veille", from: "veille", to: "Veille" },
    ]);
  });

  it("rend une liste vide sans option", () => {
    expect(planLabelFixes([])).toEqual([]);
  });
});

describe("applyLabelFixes", () => {
  it("change le nom sans changer l'identifiant ni la couleur", () => {
    const options: SelectOption[] = [
      { id: "opt_a", name: "Fançais", color: "blue" },
      { id: "opt_b", name: "IA", color: "green" },
    ];
    const fixes: LabelFix[] = [{ id: "opt_a", from: "Fançais", to: "Français" }];
    expect(applyLabelFixes(options, fixes)).toEqual([
      { id: "opt_a", name: "Français", color: "blue" },
      { id: "opt_b", name: "IA", color: "green" },
    ]);
  });

  it("est idempotent : un second passage ne trouve plus rien", () => {
    const options = [option("opt_1", "Fançais"), option("opt_2", "micro learning"), option("opt_3", "IA")];
    const once = applyLabelFixes(options, planLabelFixes(options));
    expect(planLabelFixes(once)).toEqual([]);
  });

  it("ne modifie pas la liste d'origine", () => {
    const options = [option("opt_1", "evaluation")];
    applyLabelFixes(options, planLabelFixes(options));
    expect(options[0].name).toBe("evaluation");
  });
});

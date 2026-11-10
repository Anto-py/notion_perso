import { describe, expect, it } from "vitest";
import { mentionNode, mentionProps } from "@/lib/mention";

describe("mentionProps", () => {
  it("lit une adresse et un titre, espaces compris", () => {
    expect(mentionProps({ url: " https://exemple.org ", title: " Exemple " })).toEqual({
      url: "https://exemple.org",
      title: "Exemple",
    });
  });

  it("refuse une mention sans adresse", () => {
    expect(mentionProps({ title: "Exemple" })).toBeNull();
    expect(mentionProps(null)).toBeNull();
  });
});

describe("mentionNode", () => {
  it("pose le contenu en ligne attendu", () => {
    expect(mentionNode("https://exemple.org", "Exemple")).toEqual({
      type: "mention",
      props: { url: "https://exemple.org", title: "Exemple" },
    });
  });
});

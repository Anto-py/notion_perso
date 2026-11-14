import { describe, expect, it } from "vitest";
import { hostsOfMentions, mentionHost, mentionIconUrl, mentionNode, mentionProps } from "@/lib/mention";

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

describe("mentionHost", () => {
  it("rend le nom d'hôte d'une adresse http(s)", () => {
    expect(mentionHost("https://www.Exemple.org/a?b=1")).toBe("www.exemple.org");
    expect(mentionHost("http://fr.wikipedia.org/wiki/Notion")).toBe("fr.wikipedia.org");
  });

  it("refuse une adresse qui ne peut pas nommer une icône", () => {
    expect(mentionHost("mailto:contact@exemple.org")).toBeNull();
    expect(mentionHost("javascript:alert(1)")).toBeNull();
    expect(mentionHost("http://127.0.0.1:3000/x")).toBeNull();
    expect(mentionHost("pas une url")).toBeNull();
  });
});

describe("mentionIconUrl", () => {
  it("renvoie l'icône servie par l'instance", () => {
    expect(mentionIconUrl("https://exemple.org/a")).toBe("/api/favicon/exemple.org");
  });

  it("n'a pas d'icône pour une adresse refusée", () => {
    expect(mentionIconUrl("mailto:contact@exemple.org")).toBeNull();
    expect(mentionIconUrl("https://127.0.0.1/x")).toBeNull();
  });
});

describe("hostsOfMentions", () => {
  const pages = [
    { id: "a", urls: ["https://exemple.org/1", "https://www.exemple.org/2"] },
    { id: "b", urls: ["https://prive.org/", "mailto:contact@exemple.org"] },
    { id: "c", urls: ["https://hors-portee.org/"] },
  ];

  it("ne garde que les hôtes des pages de la portée publique, une fois par hôte", () => {
    expect([...hostsOfMentions(pages, new Set(["a", "b"]))].sort()).toEqual(["exemple.org", "prive.org", "www.exemple.org"]);
  });

  it("rend un ensemble vide sans page atteinte", () => {
    expect(hostsOfMentions(pages, new Set()).size).toBe(0);
  });
});

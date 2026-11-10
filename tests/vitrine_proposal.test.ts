import { describe, expect, it } from "vitest";
import {
  PROPOSAL_NAME_MAX,
  PROPOSAL_PER_HOUR,
  PROPOSAL_REASON_MAX,
  PROPOSAL_URL_MAX,
  checkLink,
  fakeAcceptance,
  findDuplicate,
  isTrap,
  linkStatuses,
  parseProposal,
  proposalBlocks,
  splitDuplicates,
} from "@/lib/vitrine_proposal";

const entries = [
  { slug: "mindmup", title: "Mindmup", siteKey: "app.mindmup.com" },
  { slug: "quizlet", title: "Quizlet", siteKey: "quizlet.com/teachers" },
  { slug: "canva", title: "Canva", siteKey: "canva.com" },
  { slug: "video-a", title: "Vidéo A", siteKey: "youtube.com/watch?v=AAA" },
  { slug: "sans-site", title: "Sans site", siteKey: null },
];

describe("checkLink", () => {
  it("admet une adresse http(s) et rend sa forme normalisée et sa clé", () => {
    expect(checkLink(" https://www.Excalidraw.com/ ")).toEqual({ ok: true, url: "https://www.excalidraw.com/", key: "excalidraw.com" });
    expect(checkLink("http://exemple.org/a/b/")).toEqual({ ok: true, url: "http://exemple.org/a/b/", key: "exemple.org/a/b" });
  });

  it("ajoute https:// à une adresse tapée sans schéma", () => {
    expect(checkLink("excalidraw.com")).toEqual({ ok: true, url: "https://excalidraw.com/", key: "excalidraw.com" });
  });

  it("refuse un nom sans point, un autre schéma ou une adresse trop longue", () => {
    for (const raw of ["excal", "http://localhost:3021", "ftp://exemple.org", "javascript:alert(1)", "https://exemple .org"]) {
      expect(checkLink(raw), raw).toMatchObject({ ok: false });
    }
    expect(checkLink(`https://exemple.org/${"a".repeat(PROPOSAL_URL_MAX)}`)).toEqual({ ok: false, error: "Adresse trop longue." });
  });
});

describe("findDuplicate", () => {
  it("trouve l'entrée de même clé", () => {
    expect(findDuplicate("canva.com", entries)?.slug).toBe("canva");
    expect(findDuplicate("quizlet.com/teachers", entries)?.slug).toBe("quizlet");
  });

  it("une racine sans chemin couvre son hôte et ses sous-domaines", () => {
    expect(findDuplicate("quizlet.com", entries)?.slug).toBe("quizlet");
    expect(findDuplicate("mindmup.com", entries)?.slug).toBe("mindmup");
  });

  it("un chemin ne couvre rien d'autre que lui-même", () => {
    expect(findDuplicate("quizlet.com/live", entries)).toBeNull();
    expect(findDuplicate("canva.com/fr", entries)).toBeNull();
  });

  it("ne confond pas un hôte qui finit par le même texte", () => {
    expect(findDuplicate("pmup.com", entries)).toBeNull();
    expect(findDuplicate("notcanva.com", entries)).toBeNull();
  });

  it("distingue deux vidéos YouTube", () => {
    expect(findDuplicate("youtube.com/watch?v=AAA", entries)?.slug).toBe("video-a");
    expect(findDuplicate("youtube.com/watch?v=BBB", entries)).toBeNull();
  });
});

describe("linkStatuses", () => {
  it("dit l'état de chaque champ : vide, mal formé, doublon, répété, bon", () => {
    expect(linkStatuses(["", "excal", "https://www.canva.com/", "excalidraw.com", "https://excalidraw.com/"], entries)).toEqual([
      { kind: "empty" },
      { kind: "invalid", error: "Adresse mal formée, par exemple https://exemple.org" },
      { kind: "duplicate", slug: "canva", title: "Canva" },
      { kind: "ok", url: "https://excalidraw.com/", key: "excalidraw.com" },
      { kind: "repeat" },
    ]);
  });
});

describe("isTrap", () => {
  it("repère le champ piège rempli, et lui seul", () => {
    expect(isTrap({ website: "https://spam.example" })).toBe(true);
    expect(isTrap({ website: "  " })).toBe(false);
    expect(isTrap({ website: "" })).toBe(false);
    expect(isTrap({})).toBe(false);
    expect(isTrap(null)).toBe(false);
  });
});

describe("parseProposal", () => {
  it("lit les liens, la raison et le prénom", () => {
    expect(parseProposal({ links: ["https://excalidraw.com", "  "], reason: " super ", name: "Julie", website: "" })).toEqual({
      ok: true,
      links: [{ url: "https://excalidraw.com/", key: "excalidraw.com" }],
      reason: "super",
      name: "Julie",
    });
  });

  it("compte une fois le même site saisi deux fois", () => {
    const out = parseProposal({ links: ["https://www.excalidraw.com/", "excalidraw.com", "http://excalidraw.com?x=1"] });
    expect(out).toMatchObject({ ok: true, links: [{ key: "excalidraw.com" }] });
  });

  it("retire les caractères de contrôle et coupe raison et prénom à leur borne", () => {
    const out = parseProposal({ links: ["exemple.org"], reason: `a\u0000b\nc${"x".repeat(400)}`, name: "J\u0007ulie".padEnd(60, "e") });
    if (!out.ok) throw new Error("refus inattendu");
    expect(out.reason.startsWith("ab c")).toBe(true);
    expect([...out.reason]).toHaveLength(PROPOSAL_REASON_MAX);
    expect([...out.name]).toHaveLength(PROPOSAL_NAME_MAX);
    expect(out.name.startsWith("Julie")).toBe(true);
  });

  it("ignore une raison ou un prénom qui n'est pas du texte", () => {
    expect(parseProposal({ links: ["exemple.org"], reason: 3, name: ["x"] })).toMatchObject({ ok: true, reason: "", name: "" });
  });

  it("refuse un envoi illisible, sans lien ou à plus de trois liens", () => {
    expect(parseProposal(null)).toMatchObject({ ok: false });
    expect(parseProposal({ links: "https://exemple.org" })).toMatchObject({ ok: false });
    expect(parseProposal({ links: ["", " "] })).toMatchObject({ ok: false, error: "Indique au moins un lien." });
    expect(parseProposal({ links: ["a.org", "b.org", "c.org", "d.org"] })).toMatchObject({ ok: false, error: "3 liens au plus." });
  });

  it("refuse en détaillant chaque lien fautif", () => {
    expect(parseProposal({ links: ["excalidraw.com", "excal", 42] })).toEqual({
      ok: false,
      error: "Certains liens sont mal formés.",
      invalid: [
        { url: "excal", error: "Adresse mal formée, par exemple https://exemple.org" },
        { url: "42", error: "Adresse mal formée, par exemple https://exemple.org" },
      ],
    });
  });
});

describe("splitDuplicates", () => {
  it("sépare les liens neufs de ceux déjà dans la veille", () => {
    const links = [
      { url: "https://excalidraw.com/", key: "excalidraw.com" },
      { url: "https://www.mindmup.com/", key: "mindmup.com" },
    ];
    expect(splitDuplicates(links, entries)).toEqual({
      fresh: [{ url: "https://excalidraw.com/", key: "excalidraw.com" }],
      duplicates: [{ url: "https://www.mindmup.com/", slug: "mindmup", title: "Mindmup" }],
    });
  });
});

describe("proposalBlocks", () => {
  const accepted = [
    { url: "https://excalidraw.com/", title: "Excalidraw" },
    { url: "https://padlet.com/", title: "Padlet" },
  ];

  function texts(blocks: Record<string, unknown>[]) {
    return blocks.map((block) => (block.content as Record<string, unknown>[]).map((node) => (node.type === "mention" ? `@${(node.props as { title: string }).title}` : node.text)).join(""));
  }

  it("une mention par lien, puis la ligne d'attribution", () => {
    const blocks = proposalBlocks(accepted, "super pour les cartes mentales", "Julie");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(texts(blocks)).toEqual(["@Excalidraw", "@Padlet", "Proposé via la vitrine · Julie · « super pour les cartes mentales »"]);
  });

  it("omet prénom et raison vides", () => {
    expect(texts(proposalBlocks(accepted.slice(0, 1), "", ""))).toEqual(["@Excalidraw", "Proposé via la vitrine"]);
    expect(texts(proposalBlocks(accepted.slice(0, 1), "utile", ""))).toEqual(["@Excalidraw", "Proposé via la vitrine · « utile »"]);
  });
});

describe("fakeAcceptance", () => {
  it("imite un succès sans rien visiter", () => {
    expect(fakeAcceptance({ links: ["https://www.spam.example/x", "pas une adresse"], website: "x" })).toEqual({
      accepted: [{ url: "https://www.spam.example/x", title: "spam.example" }],
      duplicates: [],
      unreachable: [],
      remaining: PROPOSAL_PER_HOUR - 1,
    });
    expect(fakeAcceptance("n'importe quoi")).toMatchObject({ accepted: [] });
  });
});

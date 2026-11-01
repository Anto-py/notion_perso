import { describe, expect, it } from "vitest";
import { LINKED_PRIVATE_HTML, linkedViewHtml } from "@/lib/linked_html";
import type { EntryRow, Property } from "@/lib/properties";
import { sanitizeView } from "@/lib/views";

const statut: Property = {
  id: "prop_statut",
  name: "Statut",
  type: "select",
  options: [
    { id: "opt_fait", name: "Fait", color: "green" },
    { id: "opt_a_faire", name: "À faire", color: "gray" },
  ],
};

const entry = (patch: Partial<EntryRow> = {}): EntryRow => ({
  id: "entry_a",
  title: "Préparer le module",
  icon: null,
  values: {},
  manualOrder: "a0",
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:00:00.000Z",
  ...patch,
});

const base = { title: "To-do", icon: null };

describe("linkedViewHtml", () => {
  it("rend un tableau : titre lié puis propriétés affichées", () => {
    const view = sanitizeView({ id: "view_a" }, [statut]);
    const html = linkedViewHtml(
      base,
      [entry({ values: { prop_statut: "opt_fait" } })],
      [statut],
      view,
      { href: (id) => `/p/pub/${id}`, baseHref: "/p/pub" },
    );
    expect(html).toContain('<a href="/p/pub">');
    expect(html).toContain('<a href="/p/pub/entry_a"><span class="page-icon" aria-hidden="true">📄</span> Préparer le module</a>');
    expect(html).toContain('<th scope="col">Statut</th>');
    expect(html).toContain('<span class="chip chip-green">Fait</span>');
  });

  it("échappe le titre et les valeurs, et masque une propriété cachée", () => {
    const view = sanitizeView({ id: "view_b", hidden: ["prop_statut"] }, [statut]);
    const html = linkedViewHtml(
      { title: "<script>", icon: null },
      [entry({ title: "a<b>", values: { prop_statut: "opt_fait" } })],
      [statut],
      view,
      { href: (id) => `/x/${id}` },
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a&lt;b&gt;");
    expect(html).not.toContain("Statut");
  });

  it("rend une Galerie en cartes, image du corps comprise", () => {
    const view = sanitizeView({ id: "view_c", kind: "gallery", card_size: "large" }, [statut]);
    const html = linkedViewHtml(base, [entry({ bodyImage: "/api/media/up_abcdefghijklmnop.png" })], [statut], view, {
      href: (id) => `/x/${id}`,
    });
    expect(html).toContain("gallery-large");
    expect(html).toContain('src="/api/media/up_abcdefghijklmnop.png"');
  });

  it("dit qu'une vue liée n'a pas d'entrée", () => {
    const html = linkedViewHtml(base, [], [statut], sanitizeView({ id: "view_d" }, [statut]), { href: (id) => id });
    expect(html).toContain("Aucune entrée");
  });

  it("donne l'encart pour une base non publiée, sans titre ni entrée", () => {
    expect(LINKED_PRIVATE_HTML).toContain("Contenu privé");
    expect(LINKED_PRIVATE_HTML).not.toContain("linked-head");
  });
});

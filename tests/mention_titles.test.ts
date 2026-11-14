import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  active: 0,
  peak: 0,
  pages: {} as Record<string, { title: string; reached: boolean }>,
}));

vi.mock("@/lib/unfurl_fetch", () => ({
  unfurl: async (url: string) => {
    state.calls.push(url);
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    state.active -= 1;
    const page = state.pages[url];
    if (!page) throw new Error("site muet");
    return { title: page.title, reached: page.reached, description: "", image: null, site: "", icon: null };
  },
}));

import { fetchTitles } from "@/lib/mention_titles";

beforeEach(() => {
  state.calls.length = 0;
  state.active = 0;
  state.peak = 0;
  state.pages = {
    "https://a.org/x": { title: "Article A", reached: true },
    "https://b.org/y": { title: "Article B", reached: true },
  };
});

describe("fetchTitles", () => {
  it("lit chaque adresse distincte une fois", async () => {
    const titles = await fetchTitles(["https://a.org/x", "https://a.org/x", "https://b.org/y"]);
    expect(state.calls.sort()).toEqual(["https://a.org/x", "https://b.org/y"]);
    expect([...titles]).toEqual([
      ["https://a.org/x", "Article A"],
      ["https://b.org/y", "Article B"],
    ]);
  });

  it("borne les lectures simultanées", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://site${i}.org/`);
    for (const url of urls) state.pages[url] = { title: `Titre ${url}`, reached: true };
    await fetchTitles(urls, 2);
    expect(state.peak).toBeLessThanOrEqual(2);
    expect(state.calls).toHaveLength(6);
  });

  it("replie sur l'absence de titre", async () => {
    state.pages["https://muet.org/"] = { title: "muet.org", reached: false };
    state.pages["https://domaine.org/"] = { title: "domaine.org", reached: true };
    const titles = await fetchTitles(["https://a.org/x", "https://muet.org/", "https://domaine.org/", "https://panne.org/"]);
    expect(titles.has("https://muet.org/")).toBe(false);
    expect(titles.has("https://domaine.org/")).toBe(false);
    expect(titles.has("https://panne.org/")).toBe(false);
    expect(titles.get("https://a.org/x")).toBe("Article A");
  });

  it("ne lit rien sans adresse", async () => {
    expect((await fetchTitles([])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });
});

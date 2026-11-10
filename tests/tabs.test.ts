import { describe, expect, it } from "vitest";
import {
  appPathname,
  closeTab,
  defaultMeta,
  dropIndex,
  moveTab,
  openTab,
  restoreTabs,
  startPathname,
  tabFrom,
  visit,
  type TabsState,
} from "@/lib/tabs";

const state = (tabs: string[], active?: string): TabsState => ({
  tabs: tabs.map((href) => tabFrom(href)),
  active: active ?? tabs[0],
  ready: true,
});

describe("chemins d'application", () => {
  it("accepte les écrans du shell principal", () => {
    expect(appPathname("/")).toBe("/");
    expect(appPathname("/page/abc")).toBe("/page/abc");
    expect(appPathname("/db/abc?vue=v1")).toBe("/db/abc");
    expect(appPathname("/reglages#sauvegardes")).toBe("/reglages");
    expect(appPathname("/page/a%20b")).toBe("/page/a b");
  });

  it("écarte le partage public, la sauvegarde, l'API et l'extérieur", () => {
    expect(appPathname("/p/public")).toBeNull();
    expect(appPathname("/sauvegarde")).toBeNull();
    expect(appPathname("/api/pages")).toBeNull();
    expect(appPathname("//exemple.test/page/x")).toBeNull();
    expect(appPathname("https://exemple.test/page/x")).toBeNull();
    expect(appPathname("/login")).toBeNull();
  });

  it("nomme les écrans fixes et les types par défaut", () => {
    expect(defaultMeta("/").title).toBe("Accueil");
    expect(defaultMeta("/reglages").title).toBe("Réglages");
    expect(defaultMeta("/db/x")).toMatchObject({ title: "Base", type: "database" });
    expect(defaultMeta("/page/x")).toMatchObject({ title: "Page", type: "page" });
  });
});

describe("ouverture et visite", () => {
  it("ouvre un onglet sans doublon et l'active", () => {
    const initial = state(["/", "/page/a"]);
    const next = openTab(initial, "/page/b", { title: "B", icon: null });
    expect(next.tabs.map((tab) => tab.href)).toEqual(["/", "/page/a", "/page/b"]);
    expect(next.active).toBe("/page/b");
    const again = openTab(next, "/page/a");
    expect(again.tabs).toHaveLength(3);
    expect(again.active).toBe("/page/a");
  });

  it("active un onglet existant au lieu de le dupliquer", () => {
    const initial = state(["/", "/page/a", "/page/b"]);
    const next = openTab(initial, "/page/a");
    expect(next.tabs).toHaveLength(3);
    expect(next.active).toBe("/page/a");
  });

  it("remplace l'onglet actif lors d'une navigation vers une page neuve", () => {
    const initial = state(["/", "/page/a"], "/page/a");
    const next = visit(initial, "/page/b", { title: "B", icon: null });
    expect(next.tabs.map((tab) => tab.href)).toEqual(["/", "/page/b"]);
    expect(next.active).toBe("/page/b");
  });

  it("bascule sur l'onglet déjà ouvert sans toucher à l'actif", () => {
    const initial = state(["/", "/page/a", "/page/b"], "/page/a");
    const next = visit(initial, "/page/b");
    expect(next.active).toBe("/page/b");
    expect(next.tabs.map((tab) => tab.href)).toEqual(["/", "/page/a", "/page/b"]);
  });
});

describe("fermeture", () => {
  it("active le voisin de droite quand l'onglet fermé était actif", () => {
    const initial = state(["/", "/page/a", "/page/b"], "/page/a");
    const outcome = closeTab(initial, "/page/a");
    expect(outcome.state.tabs.map((tab) => tab.href)).toEqual(["/", "/page/b"]);
    expect(outcome.state.active).toBe("/page/b");
    expect(outcome.destination).toBe("/page/b");
  });

  it("retombe sur le voisin de gauche en fin de liste", () => {
    const initial = state(["/", "/page/a"], "/page/a");
    const outcome = closeTab(initial, "/page/a");
    expect(outcome.state.active).toBe("/");
    expect(outcome.destination).toBe("/");
  });

  it("ne navigue pas quand l'onglet fermé n'était pas actif", () => {
    const initial = state(["/", "/page/a"], "/");
    const outcome = closeTab(initial, "/page/a");
    expect(outcome.destination).toBeNull();
    expect(outcome.state.active).toBe("/");
  });

  it("ramène à l'Accueil après le dernier onglet", () => {
    const initial = state(["/page/a"], "/page/a");
    const outcome = closeTab(initial, "/page/a");
    expect(outcome.state.tabs.map((tab) => tab.href)).toEqual(["/"]);
    expect(outcome.destination).toBe("/");
  });
});

describe("ordre", () => {
  it("déplace un onglet à l'index visé", () => {
    const initial = state(["/", "/page/a", "/page/b"]);
    expect(moveTab(initial, 0, 2).tabs.map((tab) => tab.href)).toEqual(["/page/a", "/page/b", "/"]);
    expect(moveTab(initial, 2, 0).tabs.map((tab) => tab.href)).toEqual(["/page/b", "/", "/page/a"]);
  });

  it("choisit l'index selon le côté du pointeur", () => {
    expect(dropIndex(0, 2, true)).toBe(2);
    expect(dropIndex(0, 2, false)).toBe(1);
    expect(dropIndex(2, 0, false)).toBe(0);
    expect(dropIndex(2, 0, true)).toBe(1);
    expect(dropIndex(1, 1, true)).toBe(1);
  });
});

describe("reprise", () => {
  it("démarre sur la page ouverte quand rien n'est gardé", () => {
    const restored = restoreTabs(null, "/page/a");
    expect(restored.tabs.map((tab) => tab.href)).toEqual(["/page/a"]);
    expect(restored.active).toBe("/page/a");
    expect(restored.ready).toBe(true);
  });

  it("garde la session et active l'URL ouverte", () => {
    const restored = restoreTabs(
      { tabs: [{ href: "/", title: "Accueil" }, { href: "/page/a", title: "A", icon: "🌱", type: "page" }], active: "/" },
      "/page/a",
    );
    expect(restored.tabs.map((tab) => tab.href)).toEqual(["/", "/page/a"]);
    expect(restored.tabs[1].title).toBe("A");
    expect(restored.tabs[1].icon).toBe("🌱");
    expect(restored.active).toBe("/page/a");
  });

  it("ajoute l'URL ouverte absente de la session", () => {
    const restored = restoreTabs({ tabs: [{ href: "/" }], active: "/" }, "/page/b");
    expect(restored.tabs.map((tab) => tab.href)).toEqual(["/", "/page/b"]);
    expect(restored.active).toBe("/page/b");
  });

  it("écarte les entrées invalides et les doublons", () => {
    const restored = restoreTabs(
      {
        tabs: [
          { href: "/page/a" },
          { href: "/page/a" },
          { href: "/p/public" },
          { href: "https://exemple.test" },
          { href: "/sauvegarde" },
          { href: "/db/b" },
        ],
        active: "/db/b",
      },
      "/db/b",
    );
    expect(restored.tabs.map((tab) => tab.href)).toEqual(["/page/a", "/db/b"]);
  });
});

describe("page d'ouverture", () => {
  it("mène la racine à la capture sur un appareil tactile, et seulement elle", () => {
    expect(startPathname("/", true)).toBe("/inbox");
    expect(startPathname("/", false)).toBe("/");
    expect(startPathname("/page/abc", true)).toBe("/page/abc");
    expect(startPathname("/db/abc", true)).toBe("/db/abc");
  });
});

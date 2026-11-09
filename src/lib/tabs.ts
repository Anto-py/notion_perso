// Modèle des onglets ouverts : une URL d'application, un titre, une icône.
// Module pur, testé dans tests/tabs.test.ts. La navigation reste portée par
// l'URL ; ce fichier ne décrit que les transitions d'une liste d'onglets.

export type TabMeta = { title: string; icon: string | null; type?: string };
export type Tab = TabMeta & { href: string };
export type TabsState = { tabs: Tab[]; active: string | null; ready: boolean };

// Écrans du shell principal qui n'ont pas de ligne dans l'arbre.
export const STATIC_TITLES: Record<string, string> = {
  "/": "Accueil",
  "/inbox": "Vide-cerveau",
  "/trash": "Corbeille",
  "/conflits": "Conflits",
  "/import": "Importer",
  "/reglages": "Réglages",
};

const EXACT = new Set(Object.keys(STATIC_TITLES));
const PREFIXES = ["/page/", "/db/"];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isAppPathname(pathname: string): boolean {
  return EXACT.has(pathname) || PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Chemin d'application d'un href interne, ou null : liens externes, vues
// publiques (/p/), sauvegarde et routes d'API restent hors des onglets. Le
// paramètre de vue (?vue=) et l'ancre sont retirés : un onglet par écran.
export function appPathname(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  let pathname: string;
  try {
    pathname = safeDecode(new URL(href, "http://onglets.local").pathname);
  } catch {
    return null;
  }
  return isAppPathname(pathname) ? pathname : null;
}

export function defaultMeta(pathname: string): TabMeta {
  const title = STATIC_TITLES[pathname];
  if (title) return { title, icon: null };
  if (pathname.startsWith("/db/")) return { title: "Base", icon: null, type: "database" };
  if (pathname.startsWith("/page/")) return { title: "Page", icon: null, type: "page" };
  return { title: "Accueil", icon: null };
}

export function tabFrom(pathname: string, meta?: TabMeta): Tab {
  return { href: pathname, ...(meta ?? defaultMeta(pathname)) };
}

function withTab(state: TabsState, tab: Tab, activate: boolean): TabsState {
  if (state.tabs.some((item) => item.href === tab.href)) {
    return activate ? { ...state, active: tab.href } : state;
  }
  return { ...state, tabs: [...state.tabs, tab], active: activate ? tab.href : state.active };
}

// Ouverture explicite (Cmd+clic, « + ») : jamais de doublon.
export function openTab(state: TabsState, pathname: string, meta?: TabMeta, activate = true): TabsState {
  return withTab(state, tabFrom(pathname, meta), activate);
}

// Navigation ordinaire : la cible déjà ouverte active son onglet, sinon elle
// remplace l'onglet actif (modèle du navigateur).
export function visit(state: TabsState, pathname: string, meta?: TabMeta): TabsState {
  if (!state.ready) return state;
  if (state.active === pathname) return state;
  if (state.tabs.some((tab) => tab.href === pathname)) return { ...state, active: pathname };
  if (!state.active || !state.tabs.some((tab) => tab.href === state.active)) {
    return { ...state, tabs: [...state.tabs, tabFrom(pathname, meta)], active: pathname };
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.href === state.active ? tabFrom(pathname, meta) : tab)),
    active: pathname,
  };
}

// Fermeture : destination à ouvrir si l'onglet fermé était l'actif, sinon null
// (aucune navigation). Le dernier onglet fermé ramène à l'Accueil.
export function closeTab(state: TabsState, href: string): { state: TabsState; destination: string | null } {
  const index = state.tabs.findIndex((tab) => tab.href === href);
  if (index === -1) return { state, destination: null };
  const tabs = state.tabs.filter((tab) => tab.href !== href);
  if (tabs.length === 0) {
    return { state: { tabs: [tabFrom("/")], active: "/", ready: state.ready }, destination: "/" };
  }
  if (state.active !== href) return { state: { ...state, tabs }, destination: null };
  const neighbor = tabs[Math.min(index, tabs.length - 1)];
  return { state: { ...state, tabs, active: neighbor.href }, destination: neighbor.href };
}

export function moveTab(state: TabsState, from: number, to: number): TabsState {
  if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...state, tabs };
}

// Index final d'un dépôt : le pointeur décide avant ou après la cible.
export function dropIndex(from: number, over: number, after: boolean): number {
  if (from === over) return from;
  if (from < over) return after ? over : over - 1;
  return after ? over + 1 : over;
}

export type StoredTabs = {
  tabs?: { href?: unknown; title?: unknown; icon?: unknown; type?: unknown }[];
  active?: unknown;
  scroll?: Record<string, unknown>;
};

// Reprise au démarrage : l'URL ouverte fait foi. Une page absente de la
// session restaurée s'ajoute ; les entrées invalides sont écartées.
export function restoreTabs(stored: StoredTabs | null, pathname: string): TabsState {
  const current = appPathname(pathname) ?? "/";
  const tabs: Tab[] = [];
  for (const raw of Array.isArray(stored?.tabs) ? stored.tabs : []) {
    const href = typeof raw?.href === "string" ? appPathname(raw.href) : null;
    if (!href || tabs.some((tab) => tab.href === href)) continue;
    const fallback = defaultMeta(href);
    tabs.push({
      href,
      title: typeof raw.title === "string" && raw.title ? raw.title : fallback.title,
      icon: typeof raw.icon === "string" ? raw.icon : null,
      type: typeof raw.type === "string" ? raw.type : fallback.type,
    });
  }
  if (tabs.length === 0) return { tabs: [tabFrom(current)], active: current, ready: true };
  if (!tabs.some((tab) => tab.href === current)) tabs.push(tabFrom(current));
  return { tabs, active: current, ready: true };
}

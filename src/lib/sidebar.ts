// Largeur et état plié de la barre latérale, réglés par appareil (localStorage)
// et non dans le compte : un grand écran et un écran étroit n'ont pas les mêmes
// besoins. Module pur, partagé par le magasin du navigateur, le script posé
// avant peinture et ses tests.

export const SIDEBAR_LIMITS = { min: 180, max: 420, default: 260 } as const;
export const SIDEBAR_STORAGE_KEY = "np_barre";
// Attribut posé sur <html> : le CSS masque alors la barre sur ordinateur.
export const SIDEBAR_HIDDEN_ATTRIBUTE = "data-sidebar";

export type SidebarState = { width: number; hidden: boolean };

export const SIDEBAR_DEFAULT: SidebarState = { width: SIDEBAR_LIMITS.default, hidden: false };

// Une valeur absente, illisible ou non finie retombe sur 260 px ; une valeur
// valide est arrondie et ramenée entre 180 et 420 px.
export function clampSidebarWidth(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return SIDEBAR_LIMITS.default;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return SIDEBAR_LIMITS.default;
  return Math.min(SIDEBAR_LIMITS.max, Math.max(SIDEBAR_LIMITS.min, Math.round(value)));
}

// Lecture tolérante du texte rangé : JSON valide avec `width` et `hidden`,
// sinon les valeurs par défaut.
export function parseSidebarState(raw: unknown): SidebarState {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return {
    width: clampSidebarWidth(record?.width),
    hidden: record?.hidden === true,
  };
}

export function sidebarStateText(state: SidebarState): string {
  return JSON.stringify({ width: clampSidebarWidth(state.width), hidden: state.hidden === true });
}

// Exécuté dans <head> avant la peinture : applique le réglage sans laisser la
// barre apparaître une fraction de seconde. Les bornes et la clé reprennent
// celles ci-dessus ; les garder synchrones.
export const SIDEBAR_BOOT = `(function(){try{var s=JSON.parse(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")||"{}");var w=Math.round(Number(s.width));if(w>=${SIDEBAR_LIMITS.min}&&w<=${SIDEBAR_LIMITS.max}){document.documentElement.style.setProperty("--sidebar-width",w+"px")}if(s.hidden===true){document.documentElement.setAttribute("${SIDEBAR_HIDDEN_ATTRIBUTE}","hidden")}}catch(e){}})()`;

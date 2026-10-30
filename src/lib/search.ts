// Recherche, partie pure (serveur et navigateur) : mots cherchés, extrait
// renvoyé par PostgreSQL, surlignage d'un texte. La requête vit dans
// search_query.ts.
//
// Comparaison « pliée » : minuscules, sans accents, ligatures dépliées, comme
// f_unaccent côté base. Chaque mot vaut pour un début de mot (« eval » trouve
// « Évaluations ») : on cherche en tapant.

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_TERMS = 8;
const TERM_MAX = 64;

// Marqueurs de l'extrait : deux caractères de contrôle que personne ne tape.
// Du HTML (<b>) obligerait à injecter le texte tel quel dans la page.
export const HIT_START = "\u0002";
export const HIT_END = "\u0003";

const LIGATURES: Record<string, string> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae", ß: "ss" };

function foldChar(char: string): string {
  return LIGATURES[char] ?? char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Texte plié, et pour chaque caractère plié l'indice de son origine : un
// surlignage trouvé dans le pli se reporte sur le texte affiché.
export function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const out = foldChar(char);
    for (let i = 0; i < out.length; i++) origin.push(index);
    folded += out;
    index += char.length;
  }
  return { folded, origin };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

// Mots cherchés : pliés, lettres et chiffres seuls (la requête SQL ne reçoit
// jamais de syntaxe), sans doublon. Un mot d'un caractère est écarté : « l'»
// de « l'école » trouverait presque tout.
export function searchTerms(query: string): string[] {
  const words = fold(query.slice(0, 500)).folded.split(/[^\p{L}\p{N}]+/u);
  const terms: string[] = [];
  for (const word of words) {
    const term = word.slice(0, TERM_MAX);
    if (term.length < SEARCH_MIN_LENGTH || terms.includes(term)) continue;
    terms.push(term);
    if (terms.length === SEARCH_MAX_TERMS) break;
  }
  return terms;
}

export type Segment = { text: string; hit: boolean };

// Extrait de ts_headline → segments, espaces et retours à la ligne réduits.
// Un marqueur orphelin ne casse rien : il ferme ou ouvre simplement le segment.
export function parseHeadline(raw: string): Segment[] {
  const segments: Segment[] = [];
  let hit = false;
  let text = "";
  const flush = () => {
    const clean = text.replace(/\s+/g, " ");
    if (clean) segments.push({ text: clean, hit });
    text = "";
  };
  for (const char of raw) {
    if (char === HIT_START || char === HIT_END) {
      flush();
      hit = char === HIT_START;
    } else text += char;
  }
  flush();
  if (segments.length) {
    segments[0].text = segments[0].text.trimStart();
    const last = segments[segments.length - 1];
    last.text = last.text.trimEnd();
  }
  return segments.filter((segment) => segment.text);
}

// Mots du texte qui commencent par l'un des termes, en indices du texte
// d'origine [début, fin[, triés et sans chevauchement. Le mot entier est
// surligné, comme ts_headline le fait dans l'extrait.
export function highlightRanges(text: string, terms: readonly string[]): [number, number][] {
  if (!terms.length || !text) return [];
  const { folded, origin } = fold(text);
  const ranges: [number, number][] = [];
  let i = 0;
  while (i < folded.length) {
    if (!WORD_CHAR.test(folded[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < folded.length && WORD_CHAR.test(folded[end])) end++;
    const word = folded.slice(i, end);
    if (terms.some((term) => word.startsWith(term))) {
      ranges.push([origin[i], end < origin.length ? origin[end] : text.length]);
    }
    i = end;
  }
  return ranges;
}

// Texte → segments surlignés, pour un titre de résultat.
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of highlightRanges(text, terms)) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

export type SearchKind = "page" | "database" | "entry";

// Un résultat tel que l'API le renvoie ; l'extrait porte les marqueurs.
export type SearchHit = {
  id: string;
  type: SearchKind;
  title: string;
  icon: string | null;
  isInbox: boolean;
  excerpt: string;
};

// Où mène un résultat. Une page ou une entrée s'ouvre avec le terme, que
// PageView surligne ; une base s'ouvre sur sa vue, le Vide-cerveau sur /inbox.
export function resultHref(hit: { id: string; type: SearchKind; isInbox: boolean }, query: string): string {
  if (hit.isInbox) return "/inbox";
  if (hit.type === "database") return `/db/${hit.id}`;
  return `/page/${hit.id}?q=${encodeURIComponent(query.trim())}`;
}

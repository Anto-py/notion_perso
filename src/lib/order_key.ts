// Clés d'ordre fractionnaires (SPECS.md, « Synchronisation avec l'app Mac »).
// manual_order est une chaîne triée octet par octet (COLLATE "C" en base,
// comparaison < en JavaScript, jamais localeCompare) : placer une entrée entre
// deux autres n'écrit qu'elle, et deux déplacements concurrents ne se mêlent
// pas. Algorithme de David Greenspan, repris de rocicorp/fractional-indexing
// (CC0) : une partie entière de longueur variable (« a0 », « a1 »… « az »,
// « b00 »…) que l'ajout en fin incrémente, puis une partie fractionnaire qui
// ne finit jamais par « 0 ». Module pur.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const LAST = DIGITS[DIGITS.length - 1];
const SMALLEST_INTEGER = "A" + ZERO.repeat(26);

// Clé des lignes sans ordre propre (défaut de la colonne).
export const FIRST_KEY = "a0";

export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`Clé d'ordre invalide (tête « ${head} »)`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw new Error(`Clé d'ordre invalide : ${key}`);
  return key.slice(0, length);
}

export function isOrderKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key === SMALLEST_INTEGER) return false;
  if ([...key].some((char) => !DIGITS.includes(char))) return false;
  try {
    return !key.slice(integerPart(key).length).endsWith(ZERO);
  } catch {
    return false;
  }
}

function check(key: string): void {
  if (!isOrderKey(key)) throw new Error(`Clé d'ordre invalide : ${key}`);
}

// Milieu de deux parties fractionnaires (b nul : jusqu'à 1).
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

function incrementInteger(x: string): string | null {
  const [head, ...digits] = x;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) + 1;
    if (d < DIGITS.length) {
      digits[i] = DIGITS[d];
      return head + digits.join("");
    }
    digits[i] = ZERO;
  }
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const next = String.fromCharCode(head.charCodeAt(0) + 1);
  if (next > "a") digits.push(ZERO);
  else digits.pop();
  return next + digits.join("");
}

function decrementInteger(x: string): string | null {
  const [head, ...digits] = x;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) - 1;
    if (d >= 0) {
      digits[i] = DIGITS[d];
      return head + digits.join("");
    }
    digits[i] = LAST;
  }
  if (head === "a") return "Z" + LAST;
  if (head === "A") return null;
  const previous = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previous < "Z") digits.push(LAST);
  else digits.pop();
  return previous + digits.join("");
}

// Clé strictement entre a et b (nul : début ou fin de la liste).
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) check(a);
  if (b !== null) check(b);
  if (a !== null && b !== null && a >= b) throw new Error(`Clés d'ordre non croissantes : ${a}, ${b}`);
  if (a === null) {
    if (b === null) return FIRST_KEY;
    const ib = integerPart(b);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", b.slice(ib.length));
    if (ib < b) return ib;
    const lower = decrementInteger(ib);
    if (lower === null) throw new Error("Plus aucune clé d'ordre avant celle-ci");
    return lower;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  if (b === null) return incrementInteger(ia) ?? ia + midpoint(fa, null);
  const ib = integerPart(b);
  if (ia === ib) return ia + midpoint(fa, b.slice(ib.length));
  const next = incrementInteger(ia);
  if (next === null) throw new Error("Plus aucune clé d'ordre après celle-ci");
  return next < b ? next : ia + midpoint(fa, null);
}

// n clés croissantes entre a et b, aussi courtes que possible : bissection
// entre deux bornes, incrément vers une borne ouverte.
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    const keys = [keyBetween(a, null)];
    while (keys.length < n) keys.push(keyBetween(keys[keys.length - 1], null));
    return keys;
  }
  if (a === null) {
    const keys = [keyBetween(null, b)];
    while (keys.length < n) keys.unshift(keyBetween(null, keys[0]));
    return keys;
  }
  const half = Math.floor(n / 2);
  const middle = keyBetween(a, b);
  return [...keysBetween(a, middle, half), middle, ...keysBetween(middle, b, n - half - 1)];
}

// Clé du rang n (0, 1, 2…) : la n-ième partie entière, celle qu'on obtient en
// ajoutant n fois en fin depuis FIRST_KEY. La migration 0008
// (sync_order_key) en est la traduction SQL et doit le rester.
export function keyFromIndex(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Rang invalide : ${n}`);
  let length = 1;
  let span = DIGITS.length;
  while (n >= span) {
    n -= span;
    length++;
    span *= DIGITS.length;
  }
  let digits = "";
  for (let i = 0; i < length; i++) {
    digits = DIGITS[n % DIGITS.length] + digits;
    n = Math.floor(n / DIGITS.length);
  }
  return String.fromCharCode(97 + length - 1) + digits;
}

// Nouvel ordre voulu (ids) et clés actuelles : les clés à écrire, aussi peu
// que possible. La plus longue suite déjà croissante garde ses clés (pour un
// glisser, toutes sauf la carte déplacée) ; chaque groupe d'ids entre deux
// clés gardées en reçoit de neuves. Une clé absente ou en double force
// l'écriture.
export function rekey(order: readonly string[], current: ReadonlyMap<string, string>): Map<string, string> {
  const keys = order.map((id) => current.get(id));
  const kept = new Set(increasingRun(keys));
  const changes = new Map<string, string>();
  let lower: string | null = null;
  let pending: number[] = [];
  const flush = (upper: string | null) => {
    keysBetween(lower, upper, pending.length).forEach((key, i) => changes.set(order[pending[i]], key));
    pending = [];
  };
  order.forEach((_, i) => {
    if (!kept.has(i)) {
      pending.push(i);
      return;
    }
    flush(keys[i]!);
    lower = keys[i]!;
  });
  flush(null);
  return changes;
}

// Indices de la plus longue sous-suite strictement croissante de clés
// valides (patience, n log n).
function increasingRun(keys: readonly (string | undefined)[]): number[] {
  const tails: number[] = [];
  const previous = new Array<number>(keys.length).fill(-1);
  keys.forEach((key, i) => {
    if (key === undefined || !isOrderKey(key)) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]]! < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const run: number[] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = previous[i]) run.unshift(i);
  return run;
}

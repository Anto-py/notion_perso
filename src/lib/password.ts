import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt natif de Node, paramètres minimaux recommandés par l'OWASP
// (N = 2^17, r = 8, p = 1). Ils sont écrits dans le hash pour pouvoir être
// relevés plus tard sans invalider les mots de passe existants.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // scrypt refuse de dépasser maxmem (32 Mio par défaut) ; il lui faut 128·N·r octets.
  const maxmem = 256 * (options.N ?? N) * (options.r ?? R);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// Format : scrypt$N$r$p$sel$empreinte (sel et empreinte en base64url).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const expectedKey = Buffer.from(expected, "base64url");
  let key: Buffer;
  try {
    key = await derive(password, Buffer.from(salt, "base64url"), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false; // paramètres illisibles : hash corrompu, jamais un succès
  }
  // Comparaison à temps constant : la durée ne trahit pas le nombre d'octets justes.
  return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
}

import { createHash, randomBytes } from "node:crypto";

// Identifiant de ligne : préfixe lisible + 16 caractères base64url (96 bits).
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

// Secret imprévisible (jeton de session, de synchronisation, public_id) : 256 bits.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

// Empreinte d'un jeton, seule gardée en base : une fuite de la base ne donne
// aucun accès utilisable.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

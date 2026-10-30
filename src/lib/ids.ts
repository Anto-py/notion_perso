import { randomBytes } from "node:crypto";

// Identifiant de ligne : préfixe lisible + 16 caractères base64url (96 bits).
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

// Secret imprévisible (jeton de session, public_id) : 256 bits.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

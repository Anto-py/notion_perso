// Sessions et utilisateur connecté. getCurrentUser() est la seule lecture de
// l'utilisateur dans l'application (Data Access Layer, SPECS.md).
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashToken, newToken } from "./ids";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "./session_cookie";

export type User = { id: string; username: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function expiry(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_S * 1000);
}

// Hash factice, calculé une fois : un nom inconnu coûte le même temps qu'un
// mot de passe faux, la durée de réponse ne dit pas si le compte existe.
let dummyHash: Promise<string> | undefined;

export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!row) {
    await verifyPassword(password, await (dummyHash ??= hashPassword("factice")));
    return null;
  }
  if (!(await verifyPassword(password, row.passwordHash))) return null;
  return { id: row.id, username: row.username };
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: expiry() });
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

// Réglages › Compte (BRAINSTORMING §12) : exige le mot de passe actuel, puis
// ferme toutes les autres sessions de l'utilisateur ; celle d'où vient la
// demande reste ouverte. false si le mot de passe actuel est faux.
export async function changePassword(userId: string, current: string, next: string, keepToken: string): Promise<boolean> {
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || !(await verifyPassword(current, row.passwordHash))) return false;
  const passwordHash = await hashPassword(next);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(keepToken))));
  });
  return true;
}

async function userFromToken(token: string): Promise<User | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ id: users.id, username: users.username, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  // Session glissante : prolongée au plus une fois par jour, pour ne pas
  // écrire en base à chaque requête. Le cookie, lui, est prolongé par proxy.ts.
  if (row.expiresAt.getTime() < expiry().getTime() - DAY_MS) {
    await db.update(sessions).set({ expiresAt: expiry() }).where(eq(sessions.tokenHash, tokenHash));
  }
  return { id: row.id, username: row.username };
}

// cache() de React : une seule lecture de session par requête, même si dix
// composants la demandent. Lit un cookie, donc à appeler sous un <Suspense>.
// Renvoie null sans session valide : c'est la forme qu'attendent les routes
// d'API, qui répondent 401 au lieu de rediriger.
export const getSessionUser = cache(async (): Promise<User | null> => {
  // connection() : jamais dans un pré-rendu. Avec partialPrefetching, Next
  // pré-rend aussi ce qui lit les cookies ; or la vérification compare
  // l'expiration à l'heure courante et prolonge la session en base, deux
  // gestes propres à chaque requête (« new Date() while prerendering », mesuré
  // en dev le 2026-10-30, invisible au build).
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? await userFromToken(token) : null;
});

// Pour les pages : sans session valide, redirige vers /login.
export const getCurrentUser = cache(async (): Promise<User> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
});

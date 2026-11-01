// POST { current, next } : change le mot de passe (Réglages › Compte,
// BRAINSTORMING §12) et ferme les autres sessions, celle-ci restant ouverte.
import type { NextRequest } from "next/server";
import { fail, readJson, requireUser } from "@/lib/api";
import { changePassword } from "@/lib/auth";
import { createLoginThrottle } from "@/lib/login_throttle";
import { SESSION_COOKIE } from "@/lib/session_cookie";
import { newPasswordProblem } from "@/lib/settings_rules";

// Freiné par utilisateur, et non par adresse comme la connexion : la menace
// est une session volée qui chercherait le mot de passe actuel.
const throttle = createLoginThrottle();

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return fail(401, "Non connecté");

  const body = await readJson(request);
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  const problem = newPasswordProblem(current, next);
  if (problem) return fail(400, problem);

  if (throttle.retryAfter(user.id) > 0) return fail(429, "Trop de tentatives : réessayez dans quelques minutes");
  if (!(await changePassword(user.id, current, next, token))) {
    throttle.recordFailure(user.id);
    return fail(403, "Mot de passe actuel incorrect");
  }
  throttle.reset(user.id);
  return Response.json({ ok: true });
}

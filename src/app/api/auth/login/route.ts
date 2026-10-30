import { NextResponse, type NextRequest } from "next/server";
import { createSession, verifyLogin } from "@/lib/auth";
import { createLoginThrottle } from "@/lib/login_throttle";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session_cookie";

const throttle = createLoginThrottle();

// Derrière Coolify, le proxy ajoute l'adresse réelle en fin de
// X-Forwarded-For ; le début de la liste, lui, peut être forgé par le client.
function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || "local";
}

// 303 : après un POST, le navigateur suit la redirection en GET.
function back(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: NextRequest) {
  const key = clientKey(request);
  if (throttle.retryAfter(key) > 0) return back(request, "/login?erreur=attente");

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const user = username && password ? await verifyLogin(username, password) : null;
  if (!user) {
    throttle.recordFailure(key);
    return back(request, "/login?erreur=identifiants");
  }

  throttle.reset(key);
  const response = back(request, "/");
  response.cookies.set(SESSION_COOKIE, await createSession(user.id), sessionCookieOptions());
  return response;
}

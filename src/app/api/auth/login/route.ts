import type { NextRequest } from "next/server";
import { createSession, verifyLogin } from "@/lib/auth";
import { clientIp } from "@/lib/client_ip";
import { createLoginThrottle } from "@/lib/login_throttle";
import { redirectTo } from "@/lib/redirect";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session_cookie";
import { loginPath, safeReturnPath } from "@/lib/share";

const throttle = createLoginThrottle();

export async function POST(request: NextRequest) {
  const key = clientIp(request);
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  // Adresse à rejoindre après connexion, gardée aussi en cas d'échec.
  const suite = safeReturnPath(form.get("suite"));
  const retry = (erreur: string) => {
    const path = loginPath(suite);
    return redirectTo(`${path}${path.includes("?") ? "&" : "?"}erreur=${erreur}`);
  };

  if (throttle.retryAfter(key) > 0) return retry("attente");

  const user = username && password ? await verifyLogin(username, password) : null;
  if (!user) {
    throttle.recordFailure(key);
    return retry("identifiants");
  }

  throttle.reset(key);
  // 303 : après un POST, le navigateur suit la redirection en GET.
  const response = redirectTo(suite);
  response.cookies.set(SESSION_COOKIE, await createSession(user.id), sessionCookieOptions());
  return response;
}

import { NextResponse, type NextRequest } from "next/server";
import { deleteSession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session_cookie";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Supprimer la ligne en base révoque la session, même si le cookie survit.
  if (token) await deleteSession(token);

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

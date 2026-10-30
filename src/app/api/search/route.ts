import { canAccess } from "@/lib/access";
import { requireUser } from "@/lib/api";
import { searchPages } from "@/lib/search_query";

// GET ?q=… : pages, entrées et bases où chaque mot se retrouve, titres d'abord.
// Moins de deux caractères utiles : liste vide, sans requête.
export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const rows = await searchPages(query);
  return Response.json({ results: rows.filter((row) => canAccess(user, row, "read")) });
}

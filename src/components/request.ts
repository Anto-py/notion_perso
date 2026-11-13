// Requête JSON vers l'API, échecs traduits en message lisible : l'appelant
// l'affiche, il ne l'avale jamais.
// data, sur un échec : le corps de la réponse quand il en a un (le 409 d'un déplacement
// de bloc y porte la liste des avertissements de partage).
export type Result = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; data?: Record<string, unknown> };

export async function send(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Connexion perdue : action non effectuée." };
  }
  if (response.status === 401) return { ok: false, error: "Session expirée : reconnectez-vous." };
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    return { ok: false, error: typeof data?.error === "string" ? data.error : `Action refusée (${response.status}).`, ...(data ? { data } : {}) };
  }
  return { ok: true, data: data ?? {} };
}

// Titres d'adresses pour les mentions écrites par l'agent ou la capture
// (étape 22, palier c). Une lecture par adresse distincte, quatre en vol au
// plus ; une absence de titre n'est pas une erreur : la mention affiche le
// domaine et l'export le rend tel quel.
import { domainOf } from "./unfurl.ts";
import { unfurl } from "./unfurl_fetch.ts";

export const TITLE_CONCURRENCY = 4;

export async function fetchTitles(urls: readonly string[], concurrency = TITLE_CONCURRENCY): Promise<Map<string, string>> {
  const wanted = [...new Set(urls)];
  const titles = new Map<string, string>();
  if (!wanted.length) return titles;

  const limit = Math.max(1, Math.min(concurrency, wanted.length));
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const url = wanted[next++];
      try {
        const result = await unfurl(url);
        // Le repli du parse donne le domaine : il ne devient pas un titre.
        if (result.reached && result.title && result.title !== domainOf(url)) titles.set(url, result.title);
      } catch {
        // Site muet ou injoignable : pas d'entrée, donc pas de titre.
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return titles;
}

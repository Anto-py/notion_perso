// Réglages › Version sur le Mac (BRAINSTORMING §12, « Changer de version
// depuis Réglages »). GET : la version qui tourne, la dernière déployée (null
// si Coolify est injoignable), l'état de sa préparation, la version de
// secours ; avec ?commit=, seulement la version courante et la préparation de
// ce commit, sans interroger Coolify (relevés pendant la préparation et le
// redémarrage). POST { action } : « preparer » construit en arrière-plan ;
// « redemarrer » et « secours » écrivent versions/.demande puis quittent en 75
// une fois la réponse partie, et le lanceur bascule. 404 hors du lanceur.
import { after } from "next/server";
import { fail, readJson, requireUser } from "@/lib/api";
import {
  canSwitchVersion,
  fallbackVersion,
  latestCommit,
  pinnedCommit,
  preparation,
  requestSwitch,
  startPreparation,
} from "@/lib/app_version";
import { settleCycle } from "@/lib/sync_client";
import { serverVersion } from "@/lib/sync_server";
import { fallbackProblem, isCommit, parseVersionRequest, RESTART_EXIT_CODE, sameCommit } from "@/lib/version_rules";

export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!canSwitchVersion()) return fail(404, "Cette instance ne change pas de version d'elle-même");
  const current = serverVersion();
  const asked = new URL(request.url).searchParams.get("commit");
  if (asked !== null) {
    if (!isCommit(asked)) return fail(400, "Commit invalide");
    return Response.json({ current, preparation: await preparation(asked) });
  }
  const [latest, pinned] = await Promise.all([latestCommit(), pinnedCommit()]);
  const update = latest && !sameCommit(latest, current.commit) ? { commit: latest, state: await preparation(latest) } : null;
  const fallback = fallbackVersion();
  return Response.json({
    current,
    reachable: latest !== null,
    update,
    fallback: fallback && { ...fallback, problem: fallbackProblem(fallback, current.schema, pinned !== null) },
    pinned: pinned !== null,
  });
}

// Après la réponse : le navigateur sait qu'il doit attendre le nouveau
// serveur, et un cycle de synchronisation en cours finit avant l'arrêt.
function exitForSwitch(): void {
  after(async () => {
    await settleCycle();
    process.exit(RESTART_EXIT_CODE);
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!canSwitchVersion()) return fail(404, "Cette instance ne change pas de version d'elle-même");
  const body = parseVersionRequest(await readJson(request));
  if (!body) return fail(400, "Action attendue : preparer, redemarrer (avec commit) ou secours");
  const current = serverVersion();

  if (body.action === "secours") {
    const fallback = fallbackVersion();
    const problem = fallbackProblem(fallback, current.schema, (await pinnedCommit()) !== null);
    if (problem || !fallback) return fail(409, problem ?? "Aucune version de secours");
    await requestSwitch({ kind: "secours" });
    exitForSwitch();
    return Response.json({ target: fallback.commit });
  }

  if (sameCommit(body.commit, current.commit)) return fail(409, "Cette version tourne déjà");
  const state = await preparation(body.commit);
  if (body.action === "preparer") {
    if (state === "a_preparer" || state === "echec") {
      await startPreparation(body.commit);
      return Response.json({ state: "en_cours" });
    }
    return Response.json({ state });
  }
  if (state !== "prete") return fail(409, "Version pas encore prête");
  await requestSwitch({ kind: "maj", commit: body.commit });
  exitForSwitch();
  return Response.json({ target: body.commit });
}

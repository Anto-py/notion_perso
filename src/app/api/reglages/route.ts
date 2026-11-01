// PATCH { key, value } : écrit un réglage de cette instance (Réglages,
// BRAINSTORMING §12). Seules les clés d'une section affichée ici passent ;
// une valeur vide efface la clé, et le repli reprend la main.
import { fail, readJson, requireUser } from "@/lib/api";
import { currentInstance, setSetting } from "@/lib/settings";
import { parseSettingWrite } from "@/lib/settings_rules";

export async function PATCH(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  const write = parseSettingWrite(currentInstance(), body.key, body.value);
  if (!write.ok) return fail(400, write.error);
  await setSetting(write.key, write.value);
  return Response.json({ ok: true, value: write.value });
}

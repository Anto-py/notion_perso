// Réglages › Version : le commit et le schéma qui tournent. Le journal des
// migrations est lu au build, comme pour la synchronisation (serverVersion).
// Sous le lanceur du Mac, en plus : mettre à jour, revenir en secours.
import journal from "@/db/migrations/meta/_journal.json";
import { VersionSwitch } from "./VersionSwitch";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeZone: "Europe/Brussels" });

export function VersionSection({ switchable }: { switchable: boolean }) {
  const commit = process.env.SOURCE_COMMIT?.trim();
  const last = journal.entries.at(-1);
  return (
    <section id="version" className="settings-section">
      <h2>Version</h2>
      <dl className="settings-facts">
        <dt>Commit</dt>
        <dd>{commit ? <code>{commit.slice(0, 7)}</code> : <span className="hint">non renseigné (développement)</span>}</dd>
        <dt>Schéma</dt>
        <dd>
          {last ? (
            <>
              <code>{last.tag}</code>, du {DATE.format(new Date(last.when))}
            </>
          ) : (
            "aucune migration"
          )}
        </dd>
      </dl>
      {switchable && <VersionSwitch />}
    </section>
  );
}

// Réglages › Version : le commit et le schéma qui tournent. Le journal des
// migrations est lu au build, comme pour la synchronisation (serverVersion).
import journal from "@/db/migrations/meta/_journal.json";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeZone: "Europe/Brussels" });

export function VersionSection() {
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
    </section>
  );
}

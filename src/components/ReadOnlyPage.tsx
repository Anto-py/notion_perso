// Rendu en lecture seule d'une page, d'une base ou d'une entrée : le corps de
// la vue publique (BRAINSTORMING §7) et de l'écran de sauvegarde, qui ne
// diffèrent que par leur source de données et leurs liens.
// Composant serveur : le corps arrive en HTML déjà échappé (lib/blocks.ts).
import Link from "next/link";
import { linkedRefs, renderHtml, subpageRefs } from "@/lib/blocks";
import { configOf } from "@/lib/databases";
import { MEDIA_BASE } from "@/lib/icons";
import { LINKED_PRIVATE_HTML, linkedViewHtml } from "@/lib/linked_html";
import type { Page } from "@/lib/pages";
import { matchesFilters, normalizeValues, sortEntries, withTimes, type EntryRow, type Property } from "@/lib/properties";
import { cardImage, parseLinkedConfig, pickView, type View } from "@/lib/views";
import { PageCover } from "./PageCover";
import { PageIcon, PageLabel } from "./PageIcon";
import { TYPE_ICONS, ValueView } from "./propertyUi";

// Ce que le rendu demande à sa base : la base vive, ou la copie d'une
// sauvegarde (lib/backup_read.ts).
export type ReadOnlySource = {
  getPage: (id: string) => Promise<Page | null>;
  listEntries: (dbId: string) => Promise<EntryRow[]>;
};

export type ReadOnlyChild = { id: string; type: Page["type"]; title: string; icon: string | null };
export type ReadOnlyCrumb = { id: string; title: string; icon: string | null };

export type ReadOnlyPageProps = {
  page: Page;
  // Ancêtres, la page elle-même exclue.
  crumbs: ReadOnlyCrumb[];
  // Sous-pages et bases, dans l'ordre de la sidebar.
  subpages: ReadOnlyChild[];
  href: (pageId: string) => string;
  source: ReadOnlySource;
  // Route qui sert un média. Le corps stocke /api/media/<fichier> dans son
  // JSON : l'écran de sauvegarde réécrit cette base vers la sienne, seule à
  // chercher aussi dans la quarantaine.
  mediaBase?: string;
  // Vue liée : le public ne la rend que si sa base est elle-même publiée, et
  // montre sinon l'encart « Contenu privé ». L'écran de sauvegarde, privé, la
  // rend toujours.
  linkedPolicy?: "public" | "all";
};

export async function ReadOnlyPage({
  page,
  crumbs,
  subpages,
  href,
  source,
  mediaBase = MEDIA_BASE,
  linkedPolicy = "public",
}: ReadOnlyPageProps) {
  // Un bloc-lien ne mène qu'à une vraie sous-page, hors corbeille : seule
  // celle-là descend de la publication.
  const byId = new Map(subpages.map((child) => [child.id, child]));
  const linked = subpageRefs(page.body);
  return (
    <article>
      <PageCover cover={page.cover} position={page.coverPosition} className="page-cover public-cover" mediaBase={mediaBase} />
      {crumbs.length > 0 && <Crumbs crumbs={crumbs} href={href} mediaBase={mediaBase} />}
      <h1 className="public-title">
        <PageIcon icon={page.icon} type={page.type} mediaBase={mediaBase} /> {page.title || "Sans titre"}
      </h1>
      {page.type === "entry" && <EntryProperties entry={page} source={source} />}
      {page.type === "database" ? (
        <PublicDatabase database={page} href={href} source={source} mediaBase={mediaBase} />
      ) : (
        <div
          className="public-body"
          dangerouslySetInnerHTML={{ __html: await bodyHtml(page, byId, href, mediaBase, source, linkedPolicy) }}
        />
      )}
      <Children rows={subpages.filter((child) => !linked.has(child.id))} href={href} mediaBase={mediaBase} />
    </article>
  );
}

// Le corps JSON porte ses liens de média en dur : la sauvegarde réécrit leur
// base après le rendu, vers la route qui lit aussi la quarantaine.
async function bodyHtml(
  page: Page,
  byId: Map<string, ReadOnlyChild>,
  href: (id: string) => string,
  mediaBase: string,
  source: ReadOnlySource,
  linkedPolicy: "public" | "all",
): Promise<string> {
  // Les vues liées demandent les entrées d'une autre base : elles sont
  // rendues à part, puis retrouvées par leur clé au fil du corps.
  const linkedHtml = new Map<string, string>();
  for (const ref of linkedRefs(page.body)) {
    const key = linkedKey(ref.databaseId, ref.config);
    if (linkedHtml.has(key)) continue;
    linkedHtml.set(key, await linkedBlockHtml(ref.databaseId, ref.config, source, href, mediaBase, linkedPolicy));
  }
  const html = renderHtml(page.body, {
    subpage: (id) => {
      const child = byId.get(id);
      return child ? { href: href(child.id), title: child.title, icon: child.icon, type: child.type } : null;
    },
    linked: (databaseId, config) => linkedHtml.get(linkedKey(databaseId, config)) ?? null,
  });
  return mediaBase === MEDIA_BASE ? html : html.replaceAll(MEDIA_BASE, mediaBase);
}

// Deux blocs de la même base avec des vues différentes ne partagent pas leur
// rendu : la clé porte le texte de configuration.
function linkedKey(databaseId: string, config: unknown): string {
  return `${databaseId}\u0000${typeof config === "string" ? config : ""}`;
}

// Une vue liée se lit selon sa propre vue active, filtrée et triée par ses
// réglages. Publique, elle exige que la base source soit elle-même publiée :
// sinon l'encart, jamais ses entrées.
async function linkedBlockHtml(
  databaseId: string,
  config: unknown,
  source: ReadOnlySource,
  href: (id: string) => string,
  mediaBase: string,
  linkedPolicy: "public" | "all",
): Promise<string> {
  const base = await source.getPage(databaseId);
  if (!base || base.trashedAt || base.type !== "database") return LINKED_PRIVATE_HTML;
  const publicId = base.shareEnabled ? base.publicId : null;
  if (linkedPolicy === "public" && !publicId) return LINKED_PRIVATE_HTML;
  const { properties } = configOf(base);
  const view = pickView(parseLinkedConfig(config, properties).views);
  const entries = sortEntries(
    (await source.listEntries(base.id))
      .filter((entry) => matchesFilters(entry, view.filters, properties))
      .map((entry) => ({ ...entry, values: withTimes(properties, entry.values, entry) })),
    view.kind === "board" ? [] : view.sorts,
    properties,
  );
  const own = publicId ? `/p/${publicId}` : null;
  return linkedViewHtml(
    { title: base.title, icon: base.icon },
    entries,
    properties,
    view,
    {
      href: (entryId) => (own ? `${own}/${entryId}` : href(entryId)),
      baseHref: own ?? href(base.id),
      mediaBase,
    },
  );
}

function Crumbs({ crumbs, href, mediaBase }: { crumbs: ReadOnlyCrumb[]; href: (id: string) => string; mediaBase: string }) {
  return (
    <nav className="public-crumbs" aria-label="Fil d'Ariane">
      {crumbs.map((crumb, index) => (
        <span key={crumb.id}>
          {index > 0 && <span aria-hidden="true"> / </span>}
          <Link href={href(crumb.id)}>
            <PageLabel row={crumb} mediaBase={mediaBase} />
          </Link>
        </span>
      ))}
    </nav>
  );
}

// Toutes les propriétés de l'entrée, masquées dans la vue comprises : le
// masquage ne vaut que pour le tableau (choix d'Antonin du 2026-10-30). Une
// valeur vide n'est pas affichée, une case l'est toujours.
async function EntryProperties({ entry, source }: { entry: Page; source: ReadOnlySource }) {
  const base = entry.dbId ? await source.getPage(entry.dbId) : null;
  if (!base || base.trashedAt) return null;
  const { properties } = configOf(base);
  const values = withTimes(properties, normalizeValues(properties, entry.propertyValues), {
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });
  const shown = properties.filter((prop) => prop.type === "checkbox" || values[prop.id] !== undefined);
  if (!shown.length) return null;
  return (
    <div className="props public-props">
      {shown.map((prop) => (
        <div className="prop-row" key={prop.id}>
          <span className="prop-name">
            <span className="prop-icon" aria-hidden="true">
              {TYPE_ICONS[prop.type]}
            </span>
            {prop.name}
          </span>
          <div className="prop-value">
            <ValueView prop={prop} value={values[prop.id]} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Une base se lit selon sa première vue : tableau pour un Kanban ou une
// Liste, galerie pour une Galerie. Filtres, tris et propriétés masquées
// respectés dans les deux cas.
async function PublicDatabase({
  database,
  href,
  source,
  mediaBase,
}: {
  database: Page;
  href: (id: string) => string;
  source: ReadOnlySource;
  mediaBase: string;
}) {
  const { properties, views } = configOf(database);
  const view = views[0];
  const entries = await publicEntries(database, view, properties, source);
  if (!entries.length) return <p className="hint">Cette base ne contient aucune entrée.</p>;
  return view.kind === "gallery" ? (
    <ul className={`gallery-grid public-gallery gallery-${view.card_size}`}>
      {entries.map((entry) => {
        const image = cardImage(entry);
        return (
          <li key={entry.id}>
            <Link href={href(entry.id)} className="gallery-card">
              <span className="gallery-image">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={withMediaBase(image, mediaBase)} alt={view.show_title ? "" : entry.title} loading="lazy" />
                ) : (
                  <span className="gallery-fallback">
                    <PageIcon icon={entry.icon} type="entry" big mediaBase={mediaBase} />
                  </span>
                )}
              </span>
              {view.show_title && (
                <span className="gallery-title">
                  <PageLabel row={entry} mediaBase={mediaBase} />
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  ) : (
    <PublicTable entries={entries} properties={properties} view={view} href={href} mediaBase={mediaBase} />
  );
}

// Entrées d'une vue : filtres appliqués, horodatages ajoutés, tri de la vue.
async function publicEntries(
  database: Page,
  view: View,
  properties: Property[],
  source: ReadOnlySource,
): Promise<EntryRow[]> {
  return sortEntries(
    (await source.listEntries(database.id))
      .filter((entry) => matchesFilters(entry, view.filters, properties))
      .map((entry) => ({ ...entry, values: withTimes(properties, entry.values, entry) })),
    view.sorts,
    properties,
  );
}

// L'image d'une carte peut vivre dans la copie d'une sauvegarde : sa base est
// réécrite, comme pour les liens du corps.
function withMediaBase(url: string, mediaBase: string): string {
  return mediaBase === MEDIA_BASE ? url : url.replaceAll(MEDIA_BASE, mediaBase);
}

function PublicTable({
  entries,
  properties,
  view,
  href,
  mediaBase,
}: {
  entries: EntryRow[];
  properties: Property[];
  view: View;
  href: (id: string) => string;
  mediaBase: string;
}) {
  const columns = properties.filter((prop) => !view.hidden.includes(prop.id));
  return (
    <div className="table-wrap">
      <table className="db-table public-table">
        <thead>
          <tr>
            <th scope="col">Titre</th>
            {columns.map((prop) => (
              <th scope="col" key={prop.id}>
                {prop.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="cell-title">
                <Link href={href(entry.id)}>
                  <PageLabel row={entry} mediaBase={mediaBase} />
                </Link>
              </td>
              {columns.map((prop) => (
                <td key={prop.id}>
                  <ValueView prop={prop} value={entry.values[prop.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Sous-pages sans bloc-lien dans le corps (nées avant le menu « / », ou
// rangées là par glisser-déposer) : listées en bas de page pour rester
// atteignables.
function Children({ rows: children, href, mediaBase }: { rows: ReadOnlyChild[]; href: (id: string) => string; mediaBase: string }) {
  if (!children.length) return null;
  return (
    <nav className="public-children" aria-label="Sous-pages">
      <h2 className="public-children-title">Dans cette page</h2>
      <ul>
        {children.map((child) => (
          <li key={child.id}>
            <Link href={href(child.id)}>
              <PageLabel row={child} mediaBase={mediaBase} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

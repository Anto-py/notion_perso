// Vue publique d'une page, d'une base ou d'une entrée (BRAINSTORMING §7) :
// lecture seule, sans sidebar, en-tête au nom du site et pied de page signé.
// Composant serveur : le corps arrive en HTML déjà échappé (lib/blocks.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { renderHtml, safeHref, subpageRefs } from "@/lib/blocks";
import { configOf, listEntries } from "@/lib/databases";
import { getPage, type Page } from "@/lib/pages";
import { matchesFilters, normalizeValues, sortEntries } from "@/lib/properties";
import { publicHref, type PublicNode } from "@/lib/publication";
import { listChildren, resolvePublication, type Publication } from "@/lib/publication_query";
import { faviconHref } from "@/lib/icons";
import { PageIcon, PageLabel } from "./PageIcon";
import { TYPE_ICONS, ValueView } from "./propertyUi";

export type PublicParams = Promise<{ publicId: string; pageId?: string }>;

type Href = (pageId: string) => string;

// generateMetadata et la page lisent la même publication : une seule requête.
const resolve = cache(resolvePublication);

// Réglables sans toucher au code. Lus au rendu, jamais au build : ce composant
// est toujours rendu à la demande (il lit la base).
function siteName(): string {
  return process.env.SITE_NAME?.trim() || "notion_perso";
}

function linkedinUrl(): string | null {
  const href = safeHref(process.env.LINKEDIN_URL ?? "");
  return href && href.startsWith("https://") ? href : null;
}

export async function publicMetadata(params: PublicParams): Promise<Metadata> {
  const { publicId, pageId } = await params;
  const found = await resolve(publicId, pageId);
  if (!found) return { title: `Contenu indisponible · ${siteName()}`, robots: { index: false } };
  return {
    title: `${found.page.title || "Sans titre"} · ${siteName()}`,
    icons: { icon: faviconHref(found.page.icon, found.page.type) },
  };
}

export async function PublicPage({ params }: { params: PublicParams }) {
  const { publicId, pageId } = await params;
  const found = await resolve(publicId, pageId);
  return (
    <div className="public">
      <header className="public-header">
        {found ? (
          <Link href={`/p/${publicId}`} className="public-site">
            {siteName()}
          </Link>
        ) : (
          <span className="public-site">{siteName()}</span>
        )}
      </header>
      <main className="public-main">
        {found ? <PublicContent publicId={publicId} found={found} /> : <p className="public-gone">Ce contenu n&apos;est plus disponible.</p>}
      </main>
      <PublicFooter />
    </div>
  );
}

async function PublicContent({ publicId, found }: { publicId: string; found: Publication }) {
  const { root, page, chain } = found;
  const href: Href = (id) => publicHref(publicId, root.id, id);
  // Un bloc-lien ne mène qu'à une vraie sous-page, hors corbeille : seule
  // celle-là descend de la publication.
  const children = page.type === "page" ? await listChildren(page.id) : [];
  const byId = new Map(children.map((child) => [child.id, child]));
  const linked = subpageRefs(page.body);
  return (
    <article>
      {chain.length > 1 && <Crumbs chain={chain.slice(0, -1)} href={href} />}
      <h1 className="public-title">
        <PageIcon icon={page.icon} type={page.type} /> {page.title || "Sans titre"}
      </h1>
      {page.type === "entry" && <EntryProperties entry={page} />}
      {page.type === "database" ? (
        <PublicTable database={page} href={href} />
      ) : (
        <div
          className="public-body"
          dangerouslySetInnerHTML={{
            __html: renderHtml(page.body, {
              subpage: (id) => {
                const child = byId.get(id);
                return child ? { href: href(child.id), title: child.title, icon: child.icon, type: child.type } : null;
              },
            }),
          }}
        />
      )}
      <Children rows={children.filter((child) => !linked.has(child.id))} href={href} />
    </article>
  );
}

function Crumbs({ chain, href }: { chain: PublicNode[]; href: Href }) {
  return (
    <nav className="public-crumbs" aria-label="Fil d'Ariane">
      {chain.map((node, index) => (
        <span key={node.id}>
          {index > 0 && <span aria-hidden="true"> / </span>}
          <Link href={href(node.id)}><PageLabel row={node} /></Link>
        </span>
      ))}
    </nav>
  );
}

// Toutes les propriétés de l'entrée, masquées dans la vue comprises : le
// masquage ne vaut que pour le tableau (choix d'Antonin du 2026-10-30). Une
// valeur vide n'est pas affichée, une case l'est toujours.
async function EntryProperties({ entry }: { entry: Page }) {
  const base = entry.dbId ? await getPage(entry.dbId) : null;
  if (!base || base.trashedAt) return null;
  const { properties } = configOf(base);
  const values = normalizeValues(properties, entry.propertyValues);
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

// Une base se lit en tableau selon sa vue enregistrée, Kanban compris :
// filtres, tris et propriétés masquées respectés.
async function PublicTable({ database, href }: { database: Page; href: Href }) {
  const { properties, view } = configOf(database);
  const entries = sortEntries(
    (await listEntries(database.id)).filter((entry) => matchesFilters(entry, view.filters, properties)),
    view.sorts,
    properties,
  );
  if (!entries.length) return <p className="hint">Cette base ne contient aucune entrée.</p>;
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
                <Link href={href(entry.id)}><PageLabel row={entry} /></Link>
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
function Children({ rows: children, href }: { rows: { id: string; type: Page["type"]; title: string; icon: string | null }[]; href: Href }) {
  if (!children.length) return null;
  return (
    <nav className="public-children" aria-label="Sous-pages">
      <h2 className="public-children-title">Dans cette page</h2>
      <ul>
        {children.map((child) => (
          <li key={child.id}>
            <Link href={href(child.id)}><PageLabel row={child} /></Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PublicFooter() {
  const linkedin = linkedinUrl();
  return (
    <footer className="public-footer">
      <span className="public-ornament" aria-hidden="true">
        ❧
      </span>
      <p>
        Made by{" "}
        {linkedin ? (
          <a href={linkedin} target="_blank" rel="noopener noreferrer">
            Antonin Bareau
          </a>
        ) : (
          "Antonin Bareau"
        )}{" "}
        avec l&apos;aide essentielle d&apos;un ou plusieurs LLM
      </p>
    </footer>
  );
}

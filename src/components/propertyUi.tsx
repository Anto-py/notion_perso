// Affichage d'une valeur de propriété, commun au tableau, au Kanban et au
// panneau d'une entrée. Lecture seule : la saisie est dans PropertyPanel.
import Link from "next/link";
import {
  dateText,
  dateTimeText,
  formatNumber,
  normalizeValue,
  optionById,
  rollupResultType,
  type LinkRef,
  type Property,
  type PropertyType,
  type SelectOption,
} from "@/lib/properties";
import { PageIcon } from "./PageIcon";

export const TYPE_ICONS: Record<PropertyType, string> = {
  text: "Aa",
  number: "#",
  url: "🔗",
  date: "📅",
  select: "◉",
  multiselect: "☰",
  checkbox: "☑",
  created_time: "⏱",
  updated_time: "↻",
  relation: "⇄",
  rollup: "Σ",
};

// L'icône d'une propriété dans l'entrée. Une jumelle porte la flèche de retour :
// elle lit la relation déclarée dans l'autre base, elle ne la possède pas.
export function propIcon(prop: Property): string {
  return prop.twinOf ? "↩" : TYPE_ICONS[prop.type];
}

// Où mène une puce : l'app, la vue publique (seulement si la base de l'entrée
// est publiée), l'écran d'une sauvegarde. null : pas de lien.
export type LinkBuilder = (ref: LinkRef) => string | null;

function appLink(ref: LinkRef): string | null {
  return `/page/${ref.id}`;
}

export function isWebUrl(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

export function OptionChip({ option }: { option: Pick<SelectOption, "name" | "color"> }) {
  return <span className={`chip chip-${option.color}`}>{option.name}</span>;
}

// Puces d'une relation : le titre et l'icône viennent de `links`, résolus à la
// lecture. Une entrée en corbeille disparaît, sans effacer la valeur.
export function RelationChips({
  value,
  links,
  link = appLink,
  mediaBase,
}: {
  value: unknown;
  links?: readonly LinkRef[];
  link?: LinkBuilder | null;
  mediaBase?: string;
}) {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  const refs = ids.flatMap((id) => {
    const ref = links?.find((item) => item.id === id);
    return ref && !ref.trashed ? [ref] : [];
  });
  if (refs.length === 0) return null;
  return (
    <span className="chips">
      {refs.map((ref) => {
        const href = link ? link(ref) : null;
        const label = (
          <>
            <PageIcon icon={ref.icon} type="entry" mediaBase={mediaBase} /> {ref.title || "Sans titre"}
          </>
        );
        return href ? (
          <Link key={ref.id} href={href} className="chip chip-link">
            {label}
          </Link>
        ) : (
          <span key={ref.id} className="chip chip-link">
            {label}
          </span>
        );
      })}
    </span>
  );
}

// linked faux : un lien s'affiche en texte, quand la valeur est déjà dans un
// lien (ligne de la vue Liste) où un second <a> serait invalide.
export function ValueView({
  prop,
  value,
  linked = true,
  links,
  link,
  mediaBase,
}: {
  prop: Property;
  value: unknown;
  linked?: boolean;
  links?: readonly LinkRef[];
  link?: LinkBuilder | null;
  mediaBase?: string;
}) {
  const normalized = normalizeValue(prop, value);
  if (prop.type === "checkbox") {
    return <span className="check-view" aria-label={normalized ? "Cochée" : "Non cochée"}>{normalized ? "☑" : "☐"}</span>;
  }
  if (normalized === undefined) return null;
  switch (prop.type) {
    case "relation":
      return <RelationChips value={normalized} links={links} link={link ?? (linked ? appLink : null)} mediaBase={mediaBase} />;
    case "select": {
      const option = optionById(prop, normalized as string);
      return option ? <OptionChip option={option} /> : null;
    }
    case "multiselect":
      return (
        <span className="chips">
          {(normalized as string[]).map((id) => {
            const option = optionById(prop, id);
            return option ? <OptionChip key={id} option={option} /> : null;
          })}
        </span>
      );
    case "date":
      return <>{dateText(normalized as string)}</>;
    case "number":
      return <span className="number-view">{formatNumber(normalized as number, prop.format)}</span>;
    case "rollup":
      return rollupResultType(prop.calc) === "date" ? (
        <>{dateText(normalized as string)}</>
      ) : (
        <span className="number-view">{formatNumber(normalized as number, prop.format)}</span>
      );
    case "created_time":
    case "updated_time":
      return <span className="time-view">{dateTimeText(normalized as string)}</span>;
    case "url": {
      const url = normalized as string;
      return linked && isWebUrl(url) ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="url-view">
          {url.replace(/^https?:\/\/(www\.)?/i, "")}
        </a>
      ) : (
        <>{url}</>
      );
    }
    default:
      return <>{normalized as string}</>;
  }
}

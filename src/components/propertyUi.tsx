// Affichage d'une valeur de propriété, commun au tableau, au Kanban et au
// panneau d'une entrée. Lecture seule : la saisie est dans PropertyPanel.
import { normalizeValue, optionById, type Property, type PropertyType, type SelectOption } from "@/lib/properties";

export const TYPE_ICONS: Record<PropertyType, string> = {
  text: "Aa",
  url: "🔗",
  date: "📅",
  select: "◉",
  multiselect: "☰",
  checkbox: "☑",
};

// Écrit à la main plutôt que par Intl : le serveur et le navigateur rendent
// alors exactement le même texte, sans risque d'écart à l'hydratation.
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function isWebUrl(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

export function OptionChip({ option }: { option: Pick<SelectOption, "name" | "color"> }) {
  return <span className={`chip chip-${option.color}`}>{option.name}</span>;
}

export function ValueView({ prop, value }: { prop: Property; value: unknown }) {
  const normalized = normalizeValue(prop, value);
  if (prop.type === "checkbox") {
    return <span className="check-view" aria-label={normalized ? "Cochée" : "Non cochée"}>{normalized ? "☑" : "☐"}</span>;
  }
  if (normalized === undefined) return null;
  switch (prop.type) {
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
      return <>{formatDate(normalized as string)}</>;
    case "url": {
      const url = normalized as string;
      return isWebUrl(url) ? (
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

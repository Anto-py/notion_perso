"use client";
// Vue Galerie (BRAINSTORMING §4) : une carte par entrée, illustrée par son
// bandeau, à défaut la première image de son corps, à défaut l'icône de
// l'entrée. Lecture seule : l'entrée s'ouvre au clic. L'ordre est celui des
// tris de la vue, à défaut l'ordre manuel.
import Link from "next/link";
import { normalizeValue, type EntryRow, type Property } from "@/lib/properties";
import { cardImage, type CardSize } from "@/lib/views";
import { PageIcon, PageLabel } from "./PageIcon";
import { ValueView } from "./propertyUi";

type Props = {
  properties: Property[];
  entries: EntryRow[];
  filtered: boolean;
  onCreate: () => void;
  cardSize: CardSize;
  showTitle: boolean;
};

export function GalleryView({ properties, entries, filtered, onCreate, cardSize, showTitle }: Props) {
  return (
    <div className={`gallery-view gallery-${cardSize}`}>
      <ul className="gallery-grid">
        {entries.map((entry) => {
          const image = cardImage(entry);
          // Une valeur vide ne prend pas de place ; une case non cochée non plus.
          const fields = properties.filter((prop) => {
            const value = normalizeValue(prop, entry.values[prop.id]);
            return value !== undefined && (prop.type !== "checkbox" || value === true);
          });
          return (
            <li key={entry.id}>
              <Link href={`/page/${entry.id}`} className="gallery-card">
                <span className="gallery-image">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt={showTitle ? "" : entry.title} loading="lazy" />
                  ) : (
                    <span className="gallery-fallback">
                      <PageIcon icon={entry.icon} type="entry" big />
                    </span>
                  )}
                </span>
                {showTitle && (
                  <span className="gallery-title">
                    <PageLabel row={entry} />
                  </span>
                )}
                {fields.length > 0 && (
                  <span className="gallery-fields">
                    {fields.map((prop) => (
                      <span className="gallery-field" key={prop.id} title={prop.name}>
                        {prop.type === "checkbox" && <span className="list-field-name">{prop.name}</span>}
                        <ValueView prop={prop} value={entry.values[prop.id]} linked={false} />
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && filtered && <p className="hint">Aucune entrée ne correspond aux filtres.</p>}
      <button type="button" className="ghost add-entry" onClick={onCreate}>
        + Nouvelle entrée
      </button>
    </div>
  );
}

"use client";
// Bloc « signet » : une carte pour un lien, titre, description, favicon et
// image du site, comme dans Notion (BRAINSTORMING §2). Le menu « / » pose un
// bloc vide ; l'adresse est lue par /api/bookmark, qui rapatrie les images en
// médias. Une adresse que le serveur ne lit pas laisse un signet réduit à
// l'adresse, modifiable ensuite.
import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { domainOf } from "@/lib/unfurl";

type Bookmark = {
  url: string;
  title: string;
  description: string;
  favicon: string;
  image: string;
};

async function readBookmark(url: string, pageId: string): Promise<Bookmark | null> {
  try {
    const response = await fetch("/api/bookmark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, pageId }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<Bookmark> & { ok?: boolean };
    return {
      url,
      title: data.title?.trim() || url,
      description: data.description ?? "",
      favicon: data.favicon ?? "",
      image: data.image ?? "",
    };
  } catch {
    return null;
  }
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export const bookmarkBlock = createReactBlockSpec(
  {
    type: "bookmark",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      favicon: { default: "" },
      image: { default: "" },
      // Page hôte : les médias du signet suivent ses droits de partage.
      pageId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const { url, title, description, favicon, image, pageId } = block.props;
      const instance = editor as unknown as {
        updateBlock: (target: unknown, update: { props: Record<string, unknown> }) => void;
      };
      if (!url) {
        return (
          <BookmarkForm
            editable={editor.isEditable}
            onCreate={async (value) => {
              const found = await readBookmark(value, pageId);
              instance.updateBlock(block, {
                props: found ?? { url: value, title: value, description: "", favicon: "", image: "" },
              });
            }}
          />
        );
      }
      return (
        <BookmarkCard
          bookmark={{ url, title, description, favicon, image }}
          editable={editor.isEditable}
          onEdit={async (value) => {
            const found = await readBookmark(value, pageId);
            instance.updateBlock(block, {
              props: found ?? { url: value, title: value, description: "", favicon: "", image: "" },
            });
          }}
        />
      );
    },
  },
);

function BookmarkForm({ editable, onCreate }: { editable: boolean; onCreate: (url: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  if (!editable) return <p className="bookmark-empty">Signet sans adresse</p>;
  return (
    <form
      className="bookmark-form"
      contentEditable={false}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isWebUrl(value)) {
          setInvalid(true);
          return;
        }
        setBusy(true);
        await onCreate(value.trim());
        setBusy(false);
      }}
    >
      <input
        type="url"
        placeholder="Coller l'adresse d'un site"
        value={value}
        disabled={busy}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
      />
      <button type="submit" disabled={busy}>
        {busy ? "Lecture…" : "Créer"}
      </button>
      {invalid && <span className="bookmark-error">L&apos;adresse doit commencer par http:// ou https://.</span>}
    </form>
  );
}

function BookmarkCard({
  bookmark,
  editable,
  onEdit,
}: {
  bookmark: Bookmark;
  editable: boolean;
  onEdit: (url: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const domain = domainOf(bookmark.url);
  if (editing) {
    return <BookmarkEditor bookmark={bookmark} onCancel={() => setEditing(false)} onSave={onEdit} />;
  }
  return (
    <div className="bookmark-card" contentEditable={false}>
      <a className="bookmark-link" href={bookmark.url} target="_blank" rel="noopener noreferrer">
        <div className="bookmark-text">
          <div className="bookmark-site">
            {bookmark.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bookmark-favicon" src={bookmark.favicon} alt="" loading="lazy" />
            ) : (
              <span className="bookmark-favicon-glyph" aria-hidden>
                🔗
              </span>
            )}
            <span>{domain}</span>
          </div>
          <div className="bookmark-title">{bookmark.title || bookmark.url}</div>
          {bookmark.description && <div className="bookmark-description">{bookmark.description}</div>}
        </div>
        {bookmark.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bookmark-image" src={bookmark.image} alt="" loading="lazy" />
        ) : null}
      </a>
      {editable && (
        <button type="button" className="bookmark-edit" onClick={() => setEditing(true)} aria-label="Modifier le signet">
          ✎
        </button>
      )}
    </div>
  );
}

function BookmarkEditor({
  bookmark,
  onCancel,
  onSave,
}: {
  bookmark: Bookmark;
  onCancel: () => void;
  onSave: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(bookmark.url);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="bookmark-editor"
      contentEditable={false}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isWebUrl(url)) return;
        setBusy(true);
        await onSave(url.trim());
        setBusy(false);
      }}
    >
      <label>
        Adresse
        <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <div className="bookmark-editor-actions">
        <button type="submit" disabled={busy || !isWebUrl(url)}>
          {busy ? "Lecture…" : "Relire et enregistrer"}
        </button>
        <button type="button" onClick={onCancel}>
          Fermer
        </button>
      </div>
    </form>
  );
}

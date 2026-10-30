"use client";
// Éditeur BlockNote. Chargé seulement dans le navigateur (next/dynamic,
// ssr: false, dans PageView) : BlockNote manipule le DOM dès sa création.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";
import { columnStructure } from "@/lib/blocks";
import { checkUpload } from "@/lib/upload_rules";
import { youtubeId } from "@/lib/youtube";
import { columnBlock, columnListBlock } from "./columnsBlock";
import { youtubeBlock } from "./mediaBlocks";
import { subpageBlock } from "./subpageBlock";

// Blocs proposés : ceux de BRAINSTORMING §2. Ni audio ni vidéo déposée (la
// vidéo passe par YouTube), d'où une liste explicite plutôt que tout le défaut.
const {
  paragraph,
  heading,
  quote,
  bulletListItem,
  numberedListItem,
  checkListItem,
  toggleListItem,
  codeBlock,
  divider,
  image,
  file,
} = defaultBlockSpecs;

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading,
    quote,
    bulletListItem,
    numberedListItem,
    checkListItem,
    toggleListItem,
    codeBlock,
    divider,
    image,
    file,
    youtube: youtubeBlock(),
    subpage: subpageBlock(),
    columnList: columnListBlock(),
    column: columnBlock(),
  },
});

export type EditorBlocks = (typeof schema.Block)[];

export type UploadState = { progress: number } | { error: string } | null;

export type ChildKind = "page" | "database";

type Props = {
  pageId: string;
  initialBody: unknown[];
  // Présent seulement là où une sous-page peut naître (une page, pas une
  // entrée) : crée l'enfant et rend son id, null en cas d'échec.
  onCreateChild?: (kind: ChildKind) => Promise<string | null>;
  onChange: (body: EditorBlocks) => void;
  onUploadState: (state: UploadState) => void;
};

export type EditorInstance = typeof schema.BlockNoteEditor;

// Le menu « / » pose le nombre de colonnes ; les commandes du bloc permettent
// ensuite d'en ajouter une (jusqu'à quatre) ou d'en retirer une.
const COLUMNS_GROUP = "Mise en page";

function columnItems(editor: EditorInstance) {
  return [2, 3, 4].map((count) => ({
    title: `${count} colonnes`,
    subtext: `${count} colonnes de blocs côte à côte`,
    aliases: ["colonne", "colonnes", "column", "columns", String(count)],
    group: COLUMNS_GROUP,
    icon: <span aria-hidden>{"❙".repeat(count)}</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, columnStructure(count)),
  }));
}

// La traduction française range l'image dans « Médias » et le fichier dans
// « Média ». Le menu regroupe les éléments consécutifs de même rubrique :
// on unifie le nom, et YouTube se glisse juste après le dernier média.
const MEDIA_GROUP = "Médias";

// Le bloc s'insère aussitôt, en attente, puis reçoit l'id de l'enfant créé :
// le curseur reste à sa place pendant la requête. Un échec retire le bloc.
function childItems(editor: EditorInstance, onCreateChild: (kind: ChildKind) => Promise<string | null>) {
  const item = (kind: ChildKind, title: string, subtext: string, aliases: string[], icon: string) => ({
    title,
    subtext,
    aliases,
    group: "Pages",
    icon: <span aria-hidden>{icon}</span>,
    onItemClick: () => {
      const inserted = insertOrUpdateBlockForSlashMenu(editor, { type: "subpage", props: { kind } });
      void onCreateChild(kind).then((id) => {
        const block = editor.getBlock(inserted.id);
        if (!block) return;
        if (id) editor.updateBlock(block, { props: { pageId: id } });
        else editor.removeBlocks([block]);
      });
    },
  });
  return [
    item("page", "Page", "Créer une sous-page ici", ["page", "sous-page", "subpage"], "📄"),
    item("database", "Base", "Créer une base de données ici", ["base", "database", "tableau", "kanban"], "🗃️"),
  ];
}

function slashItems(editor: EditorInstance, onCreateChild?: (kind: ChildKind) => Promise<string | null>) {
  const items = getDefaultReactSlashMenuItems(editor).map((item) =>
    item.group === "Média" ? { ...item, group: MEDIA_GROUP } : item,
  );
  // Pages, puis colonnes, puis les blocs courants.
  items.unshift(...(onCreateChild ? childItems(editor, onCreateChild) : []), ...columnItems(editor));
  const youtube = {
    title: "Vidéo YouTube",
    subtext: "Intégrer une vidéo par son lien",
    aliases: ["youtube", "video", "vidéo", "embed"],
    group: MEDIA_GROUP,
    icon: <span aria-hidden>▶</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "youtube" }),
  };
  const lastMedia = items.findLastIndex((item) => item.group === MEDIA_GROUP);
  items.splice(lastMedia + 1, 0, youtube);
  return items;
}

export default function Editor({ pageId, initialBody, onCreateChild, onChange, onUploadState }: Props) {
  // uploadFile n'est appelé qu'après la création de l'éditeur : la ref est
  // alors remplie (effet ci-dessous).
  const editorRef = useRef<EditorInstance | null>(null);
  const editor = useCreateBlockNote({
    schema,
    dictionary: fr,
    initialContent: initialBody.length ? (initialBody as (typeof schema.PartialBlock)[]) : undefined,
    // BlockNote insère le bloc avant d'appeler l'envoi : en cas d'échec, on
    // retire ce bloc resté vide, le message d'erreur s'affiche en haut de page.
    uploadFile: (upload: File, blockId?: string) =>
      uploadFile(upload, pageId, onUploadState).catch((error: unknown) => {
        const block = blockId ? editorRef.current?.getBlock(blockId) : undefined;
        if (block && !(block.props as { url?: string }).url) editorRef.current?.removeBlocks([block]);
        throw error;
      }),
    // Une URL YouTube collée seule devient un lecteur intégré.
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      // Fichier collé hors règles : refus avant que BlockNote n'insère un bloc.
      const refused = [...(event.clipboardData?.files ?? [])].map(checkUpload).find((check) => !check.ok);
      if (refused && !refused.ok) {
        onUploadState({ error: refused.error });
        return true;
      }
      const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (!youtubeId(text)) return defaultPasteHandler();
      const current = editor.getTextCursorPosition().block;
      const isEmpty = Array.isArray(current.content) && current.content.length === 0;
      if (isEmpty) editor.updateBlock(current, { type: "youtube", props: { url: text } });
      else editor.insertBlocks([{ type: "youtube", props: { url: text } }], current, "after");
      return true;
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  return (
    <BlockNoteView editor={editor} theme="light" slashMenu={false} onChange={() => onChange(editor.document)}>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(slashItems(editor, onCreateChild), query)}
      />
    </BlockNoteView>
  );
}

// Envoi par XMLHttpRequest : fetch ne donne pas la progression d'un envoi.
// Les règles d'upload_rules refusent avant d'envoyer ; le serveur les rejoue.
function uploadFile(upload: File, pageId: string, onState: (state: UploadState) => void): Promise<string> {
  const check = checkUpload(upload);
  if (!check.ok) {
    onState({ error: check.error });
    return Promise.reject(new Error(check.error));
  }
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", upload);
    form.append("pageId", pageId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onState({ progress: Math.round((event.loaded / event.total) * 100) });
    };
    const failWith = (message: string) => {
      onState({ error: message });
      reject(new Error(message));
    };
    xhr.onload = () => {
      const body = xhr.response as { url?: string; error?: string } | null;
      if (xhr.status === 200 && body?.url) {
        onState(null);
        resolve(body.url);
      } else failWith(body?.error ?? `Envoi refusé (${xhr.status})`);
    };
    xhr.onerror = () => failWith("Envoi interrompu : connexion perdue.");
    onState({ progress: 0 });
    xhr.send(form);
  });
}

"use client";
// Éditeur BlockNote. Chargé seulement dans le navigateur (next/dynamic,
// ssr: false, dans PageView) : BlockNote manipule le DOM dès sa création.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { getDefaultReactSlashMenuItems, SideMenuController, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { columnStructure } from "@/lib/blocks";
import { checkUpload } from "@/lib/upload_rules";
import { dropSpot, onEditorDrop, onEditorHover, type DropSpot } from "./editor_drop";
import { useEdgeScroll } from "./use_edge_scroll";
import { planBlockRuns } from "@/lib/web_save";
import { youtubeId } from "@/lib/youtube";
import { columnBlock, columnListBlock } from "./columnsBlock";
import { BlockSideMenu } from "./BlockMenu";
import { BlockMoveProvider } from "./BlockMove";
import { bookmarkBlock } from "./bookmarkBlock";
import { conflictBlock } from "./conflictBlock";
import { linkedBlock } from "./linkedBlock";
import { youtubeBlock } from "./mediaBlocks";
import { mentionSpec } from "./mention_inline";
import { getPageDirectory, markFreshLink, subpageBlock } from "./subpageBlock";

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
  table,
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
    // Bloc natif de BlockNote, absent du menu « / » : l'import HTML des
    // tableaux Notion le pose.
    table,
    youtube: youtubeBlock(),
    bookmark: bookmarkBlock(),
    subpage: subpageBlock(),
    linked: linkedBlock(),
    columnList: columnListBlock(),
    column: columnBlock(),
    // Jamais proposé au menu « / » : seule une fusion le pose.
    conflict: conflictBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionSpec,
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
  // Message d'un geste refusé ou raté (déplacement d'un bloc), affiché en haut
  // de la page ; chaîne vide pour l'effacer.
  onError: (message: string) => void;
  // Poignée tendue à PageView, qui n'importe rien de ce module chargé
  // seulement dans le navigateur ; null quand l'éditeur disparaît.
  onReady?: (handle: EditorHandle | null) => void;
};

export type EditorHandle = { getDocument: () => unknown[]; replace: (target: unknown[]) => void };

export type EditorInstance = typeof schema.BlockNoteEditor;
type PartialBlock = typeof schema.PartialBlock;

// Pose une version venue du serveur sans faire sauter le curseur : seuls les
// passages qui diffèrent sont remplacés (planBlockRuns), en une transaction
// gardée hors de l'historique, pour qu'un Cmd + Z ne défasse pas la fusion.
function replaceDocument(editor: EditorInstance, target: unknown[]): void {
  if (!target.length) return;
  const runs = planBlockRuns(editor.document, target);
  if (!runs.length) return;
  editor.transact((tr) => {
    tr.setMeta("addToHistory", false);
    for (const run of runs) {
      const insert = run.insert as PartialBlock[];
      if (run.remove.length && insert.length) editor.replaceBlocks(run.remove, insert);
      else if (run.remove.length) editor.removeBlocks(run.remove);
      else if (run.after) editor.insertBlocks(insert, run.after, "after");
      else if (run.before) editor.insertBlocks(insert, run.before, "before");
      else editor.replaceBlocks(editor.document, insert);
    }
  });
}

// Page de l'arbre déposée dans ce corps (editor_drop.ts) : son bloc se pose à
// l'endroit visé, et un bloc propriétaire déjà présent s'en va dans la même
// transaction. useSubpages voit donc le compte de blocs inchangé et ne jette
// rien. Sans endroit (corps vide), le bloc va en bas.
type DocBlock = { id: string; type: string; props: Record<string, unknown>; children: DocBlock[] };

function ownerBlocksOf(blocks: readonly DocBlock[], childId: string): DocBlock[] {
  return blocks.flatMap((block) => [
    ...(block.type === "subpage" && block.props.pageId === childId && block.props.link !== true ? [block] : []),
    ...ownerBlocksOf(block.children ?? [], childId),
  ]);
}

function placeSubpage(editor: EditorInstance, childId: string, spot: DropSpot | null): void {
  const existing = ownerBlocksOf(editor.document as unknown as DocBlock[], childId);
  if (spot && existing.some((block) => block.id === spot.blockId)) return;
  const block = { type: "subpage", props: { pageId: childId, kind: "page" } } as unknown as PartialBlock;
  const last = editor.document[editor.document.length - 1];
  editor.transact(() => {
    if (spot) editor.insertBlocks([block], spot.blockId, spot.placement);
    else editor.insertBlocks([block], last, "after");
    if (existing.length) editor.removeBlocks(existing.map((owner) => owner.id));
  });
}

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
// Une base naît sous « Bases de données » (étapes 16 et 17) : ailleurs, le bloc
// en attente cède la place à une base encastrée de même position, qui n'a aucun
// pouvoir sur sa base ; dans « Bases de données » même, il reste un lien icône
// + nom, comme une sous-page (choix d'Antonin du 2026-11-11).
function childItems(editor: EditorInstance, pageId: string, onCreateChild: (kind: ChildKind) => Promise<string | null>) {
  const item = (kind: ChildKind, title: string, subtext: string, aliases: string[], icon: string) => ({
    title,
    subtext,
    aliases,
    group: "Pages",
    icon: <span aria-hidden>{icon}</span>,
    onItemClick: () => {
      const inserted = insertOrUpdateBlockForSlashMenu(editor, { type: "subpage", props: { kind } });
      const inBasesRoot = getPageDirectory().get(pageId)?.basesRoot === true;
      void onCreateChild(kind).then((id) => {
        const block = editor.getBlock(inserted.id);
        if (!block) return;
        if (id && kind === "database" && !inBasesRoot) editor.replaceBlocks([block], [{ type: "linked", props: { databaseId: id, embed: true } }]);
        else if (id) editor.updateBlock(block, { props: { pageId: id } });
        else editor.removeBlocks([block]);
      });
    },
  });
  return [
    item("page", "Page", "Créer une sous-page ici", ["page", "sous-page", "subpage"], "📄"),
    item("database", "Nouvelle base", "Créer une base sous « Bases de données », l’encastrer ici", ["base", "database", "tableau", "kanban"], "🗃️"),
  ];
}

// Un lien vers une page ou une base rangée ailleurs : le bloc de sous-page avec
// link: true, dont le sélecteur s'ouvre aussitôt (PagePicker). Proposé sur une
// page comme sur une entrée : il ne crée rien.
const pageLinkItem = (editor: EditorInstance) => ({
  title: "Lien vers une page",
  subtext: "Citer une page ou une base rangée ailleurs",
  aliases: ["lien", "link", "page", "base", "renvoi", "mention"],
  group: "Pages",
  icon: <span aria-hidden>↗</span>,
  onItemClick: () => {
    const inserted = insertOrUpdateBlockForSlashMenu(editor, { type: "subpage", props: { link: true } });
    markFreshLink(inserted.id);
  },
});

// Une base existante, montrée avec son bandeau et son emoji (étape 17).
const embedItem = (editor: EditorInstance) => ({
  title: "Base",
  subtext: "Encastrer une base existante, bandeau et emoji compris",
  aliases: ["base", "embed", "encastrée", "encastree", "database", "tableau"],
  group: "Pages",
  icon: <span aria-hidden>🗃️</span>,
  onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "linked", props: { embed: true } }),
});

// Une base existante, montrée avec ses propres vues seules (bloc « linked »).
const linkedItem = (editor: EditorInstance) => ({
  title: "Vue liée",
  subtext: "Afficher une base existante, avec ses propres vues",
  aliases: ["vue liée", "vue liee", "liée", "linked", "base"],
  group: "Pages",
  icon: <span aria-hidden>🔗</span>,
  onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "linked", props: { embed: false } }),
});

// Le signet naît vide ; son adresse est lue par /api/bookmark. La page hôte
// voyage dans le bloc pour que les médias rapatriés suivent ses droits.
const bookmarkItem = (editor: EditorInstance, pageId: string) => ({
  title: "Signet",
  subtext: "Une carte pour un lien, avec son aperçu",
  aliases: ["signet", "bookmark", "lien", "carte", "aperçu", "apercu"],
  group: MEDIA_GROUP,
  icon: <span aria-hidden>🔖</span>,
  onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "bookmark", props: { pageId } }),
});

function slashItems(
  editor: EditorInstance,
  pageId: string,
  onCreateChild?: (kind: ChildKind) => Promise<string | null>,
) {
  const items = getDefaultReactSlashMenuItems(editor).map((item) =>
    item.group === "Média" ? { ...item, group: MEDIA_GROUP } : item,
  );
  // Pages, le lien, la base encastrée ou la vue liée, puis colonnes, puis les
  // blocs courants.
  items.unshift(
    ...(onCreateChild ? childItems(editor, pageId, onCreateChild) : []),
    pageLinkItem(editor),
    embedItem(editor),
    linkedItem(editor),
    ...columnItems(editor),
  );
  items.push(bookmarkItem(editor, pageId));
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

export default function Editor({ pageId, initialBody, onCreateChild, onChange, onUploadState, onError, onReady }: Props) {
  // uploadFile n'est appelé qu'après la création de l'éditeur : la ref est
  // alors remplie (effet ci-dessous).
  const editorRef = useRef<EditorInstance | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  useEdgeScroll(hostRef);
  const editor = useCreateBlockNote({
    schema,
    dictionary: fr,
    // « En-tête de ligne » et « En-tête de colonne » du menu de bloc d'un
    // tableau, et des poignées de ligne et de colonne : éteints par défaut.
    tables: { headers: true },
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
    onReady?.({ getDocument: () => editor.document, replace: (target) => replaceDocument(editor, target) });
    return () => onReady?.(null);
  }, [editor, onReady]);

  // Dépôt d'une page de l'arbre : trait d'insertion au survol, bloc posé au
  // lâcher. Seulement là où une sous-page peut naître.
  const acceptsSubpages = !!onCreateChild;
  const [spot, setSpot] = useState<DropSpot | null>(null);
  useEffect(() => {
    if (!acceptsSubpages) return;
    const offHover = onEditorHover((hover) => {
      const host = hostRef.current;
      setSpot(hover && host && hover.hostId === pageId ? dropSpot(host, hover.point) : null);
    });
    const offDrop = onEditorDrop(({ hostId, pageId: childId, point }) => {
      setSpot(null);
      const host = hostRef.current;
      if (hostId === pageId && host) placeSubpage(editor, childId, dropSpot(host, point));
    });
    return () => {
      offHover();
      offDrop();
    };
  }, [acceptsSubpages, editor, pageId]);

  return (
    <div ref={hostRef} className="editor-host" data-drop-page={acceptsSubpages ? pageId : undefined}>
      {spot && <div className="editor-drop-line" style={{ top: spot.top, left: spot.left, width: spot.width }} aria-hidden />}
      <BlockNoteView editor={editor} theme="light" slashMenu={false} sideMenu={false} onChange={() => onChange(editor.document)}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(slashItems(editor, pageId, onCreateChild), query)}
        />
        <BlockMoveProvider pageId={pageId} onError={onError}>
          <SideMenuController sideMenu={BlockSideMenu} />
        </BlockMoveProvider>
      </BlockNoteView>
    </div>
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

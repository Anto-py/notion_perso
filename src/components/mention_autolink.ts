// Mentions de sites (étape 22) : une adresse nue posée dans une page ordinaire
// devient une mention, avec son titre lu par /api/unfurl. Les règles de
// reconnaissance sont pures (lib/mention_links.ts) ; ce module tient le geste
// dans l'éditeur.
//
// Deux chemins : un collage (l'éditeur, avant ou après le geste par défaut) et
// une frappe (l'autolink de BlockNote crée le lien, l'extension le convertit
// dans la transaction suivante). Une page ouverte ne bouge pas : l'extension
// ne voit que des transactions, jamais le contenu de départ ; un annuler n'est
// pas converti et rend le lien nu.
import { createExtension } from "@blocknote/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { bareUrlsInText, isBareLink, type UrlSpan } from "@/lib/mention_links";

// Ce que les fonctions demandent à l'éditeur : ses deux vues ProseMirror.
type Editor = { readonly prosemirrorState: EditorState; readonly prosemirrorView: EditorView };

// Marque nos propres transactions : l'extension ne se relance pas dessus.
const OURS = "mentionizeTransaction";
const pluginKey = new PluginKey("mentionize");

// Position dans un bloc de code, ou dans du code en ligne : l'adresse y reste
// du texte, jamais une mention.
export function isInCode(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.spec.code === true || node.type.name === "codeBlock") return true;
  }
  return false;
}

// Deux nœuds texte contigus avec le même lien forment une seule adresse (un
// morceau en gras ne la coupe pas).
function merge(spans: UrlSpan[]): UrlSpan[] {
  const merged: UrlSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && last.to === span.from && last.url === span.url) last.to = span.to;
    else merged.push({ ...span });
  }
  return merged;
}

function linkHref(node: PMNode): string | null {
  const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href;
  return typeof href === "string" ? href : null;
}

function bareSpans(doc: PMNode): UrlSpan[] {
  const spans: UrlSpan[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    const href = linkHref(node);
    if (href && isBareLink(node.text, href)) spans.push({ from: pos, to: pos + node.text.length, url: href });
  });
  return merge(spans);
}

function pmMention(doc: PMNode, url: string, title: string): PMNode | null {
  const type = doc.type.schema.nodes.mention;
  return type ? type.create({ url, title }) : null;
}

// Remplace, du plus loin au plus près, chaque intervalle par une mention. Une
// seule transaction, gardée dans l'historique (Cmd + Z rend le lien) mais
// fermant l'événement précédent pour que l'annuler ne défasse que ceci.
function replaceWithMentions(view: EditorView, spans: UrlSpan[]): boolean {
  if (!spans.length) return false;
  const tr = view.state.tr;
  let changed = false;
  for (const span of [...spans].sort((a, b) => b.from - a.from)) {
    const mention = pmMention(tr.doc, span.url, "");
    if (!mention) continue;
    tr.replaceWith(span.from, span.to, mention);
    changed = true;
  }
  if (!changed) return false;
  tr.setMeta("preventAutolink", true);
  tr.setMeta(OURS, true);
  closeHistory(tr);
  view.dispatch(tr);
  return true;
}

// Conversion des adresses nues d'un intervalle qui vient d'être collé : liens
// déjà titrés exclus, texte brut compris (une adresse collée sans lien).
export function convertPastedRange(editor: Editor, from: number, to: number): void {
  const state = editor.prosemirrorState;
  const spans: UrlSpan[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;
    if (pos < from || pos + node.text.length > to) return;
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    const href = linkHref(node);
    if (href && isBareLink(node.text, href)) {
      spans.push({ from: pos, to: pos + node.text.length, url: href });
      return;
    }
    for (const found of bareUrlsInText(node.text)) {
      spans.push({ from: pos + found.from, to: pos + found.to, url: found.url });
    }
  });
  const fresh = merge(spans).filter((span) => !isInCode(state.doc, span.from));
  if (replaceWithMentions(editor.prosemirrorView, fresh)) void fillTitles(editor.prosemirrorView, [...new Set(fresh.map((span) => span.url))]);
}

// Adresse collée seule : le lien d'abord (pour que Cmd + Z le rende nu), puis
// la mention. Le collage d'une adresse YouTube reste un lecteur (Editor).
export function insertPastedMention(editor: Editor, url: string): void {
  const state = editor.prosemirrorState;
  const from = state.selection.from;
  const tr = state.tr.replaceSelectionWith(state.schema.text(url));
  const link = state.schema.marks.link;
  if (link) tr.addMark(from, from + url.length, link.create({ href: url }));
  editor.prosemirrorView.dispatch(tr);
  convertPastedRange(editor, from, from + url.length);
}

// L'extension : à chaque transaction d'écriture, elle convertit les liens nus
// qui n'existaient pas dans l'état d'avant. L'état de la vue est gardé par le
// point d'accroche `view`, pour lire les titres sans dépendre d'un composant.
export function mentionizeExtension() {
  let view: EditorView | null = null;
  const plugin = new Plugin({
    key: pluginKey,
    view: (editorView) => {
      view = editorView;
      return {
        destroy: () => {
          view = null;
        },
      };
    },
    appendTransaction: (transactions, oldState, newState) => {
      if (transactions.some((tr) => isHistoryTransaction(tr) || tr.getMeta(OURS) || tr.getMeta("addToHistory") === false)) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const known = new Set<number>();
      for (const span of bareSpans(oldState.doc)) {
        let pos = span.from;
        for (const tr of transactions) pos = tr.mapping.map(pos);
        known.add(pos);
      }
      const fresh = bareSpans(newState.doc).filter((span) => !known.has(span.from) && !isInCode(newState.doc, span.from));
      if (!fresh.length) return null;

      const tr = newState.tr;
      let changed = false;
      for (const span of [...fresh].sort((a, b) => b.from - a.from)) {
        const mention = pmMention(newState.doc, span.url, "");
        if (!mention) continue;
        tr.replaceWith(span.from, span.to, mention);
        changed = true;
      }
      if (!changed) return null;
      tr.setMeta("preventAutolink", true);
      tr.setMeta(OURS, true);
      closeHistory(tr);
      if (view) void fillTitles(view, [...new Set(fresh.map((span) => span.url))]);
      return tr;
    },
  });
  return createExtension({ key: "mentionize", prosemirrorPlugins: [plugin] });
}

// Titre lu une fois par adresse, gardé le temps de la session. Un site muet,
// protégé ou privé laisse le titre vide : l'affichage retombe sur le domaine.
const titles = new Map<string, Promise<string>>();

function titleOf(url: string): Promise<string> {
  let pending = titles.get(url);
  if (!pending) {
    pending = fetch(`/api/unfurl?url=${encodeURIComponent(url)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { title?: unknown; reached?: unknown } | null) =>
        data && data.reached !== false && typeof data.title === "string" ? data.title : "",
      )
      .catch(() => "");
    titles.set(url, pending);
  }
  return pending;
}

export async function fillTitles(view: EditorView, urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const title = await titleOf(url);
      if (!title || view.isDestroyed) return;
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== "mention" || node.attrs.url !== url || node.attrs.title) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, title });
      });
      if (!tr.docChanged) return;
      // Lu et non tapé : l'historique ne le retient pas.
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
    }),
  );
}

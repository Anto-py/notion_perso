"use client";
// Formulaire « Proposer une ressource » (§11) : <dialog> natif ouvert par
// showModal(), comme la fiche. Les liens se contrôlent au fil de la frappe
// (linkStatuses : forme, doublon de la base, même site saisi deux fois) ;
// seuls les liens bons et neufs partent, le serveur refait tout. La saisie
// survit à la fermeture et à un échec ; un succès vide le formulaire et le
// laisse ouvert.
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { VitrineEntry } from "@/lib/vitrine";
import { PROPOSAL_LINKS_MAX, PROPOSAL_NAME_MAX, PROPOSAL_REASON_MAX, linkStatuses, type LinkStatus, type ProposalResponse } from "@/lib/vitrine_proposal";

type Props = { open: boolean; entries: VitrineEntry[]; onClose: () => void; onSee: (slug: string) => void };
type Field = { id: number; value: string; refused: boolean };
type Notice = { text: string; tone: "ok" | "error" };

const UNREACHABLE = "Ce site ne répond pas, vérifie l'adresse.";
const FAILED = "L'envoi a échoué, réessaie dans un instant.";

export function VitrineProposal({ open, entries, onClose, onSee }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // Identifiants stables entre serveur et navigateur : préfixe de useId,
  // compteur propre au formulaire (jamais un compteur de module, qui tourne
  // d'une requête à l'autre sur le serveur).
  const uid = useId();
  const counter = useRef(1);
  const [fields, setFields] = useState<Field[]>([{ id: 0, value: "", refused: false }]);
  const blank = (): Field => ({ id: counter.current++, value: "", refused: false });
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const statuses = linkStatuses(
    fields.map((field) => field.value),
    entries,
  );

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      node.querySelector<HTMLInputElement>("input[data-link]")?.focus();
    }
    if (!open && node.open) node.close();
  }, [open]);

  // Champ à focaliser après le rendu : celui qu'on vient d'ajouter, ou le
  // voisin de celui qu'on retire (le bouton cliqué disparaît avec lui).
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    document.getElementById(`${uid}-link-${focusNext.current}`)?.focus();
    focusNext.current = null;
  }, [fields, uid]);

  function addField() {
    const field = blank();
    focusNext.current = field.id;
    setFields((list) => [...list, field]);
  }

  function removeField(id: number) {
    const index = fields.findIndex((field) => field.id === id);
    const rest = fields.filter((field) => field.id !== id);
    focusNext.current = rest[Math.max(0, index - 1)]?.id ?? null;
    setFields(rest);
  }

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function edit(id: number, value: string) {
    setFields((list) => list.map((field) => (field.id === id ? { ...field, value, refused: false } : field)));
    setNotice(null);
  }

  function focusField(index: number) {
    form.current?.querySelectorAll<HTMLInputElement>("input[data-link]")[index]?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const invalid = statuses.findIndex((status) => status.kind === "invalid");
    if (invalid >= 0) return focusField(invalid);
    const sendable = statuses.flatMap((status, index) => (status.kind === "ok" ? [{ url: status.url, field: fields[index] }] : []));
    if (!sendable.length) {
      const duplicates = statuses.some((status) => status.kind === "duplicate");
      setNotice({ text: duplicates ? "Ces ressources sont déjà dans la veille." : "Indique au moins un lien.", tone: "error" });
      return;
    }

    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/veille/proposer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: sendable.map((link) => link.url), reason, name, website }),
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const known = (response.status === 429 || response.status === 400) && data?.error;
        setNotice({ text: known ? data.error! : FAILED, tone: "error" });
        return;
      }
      const result = (await response.json()) as ProposalResponse;
      // Restent à l'écran les liens refusés comme injoignables, signalés ;
      // les envoyés et les doublons s'effacent.
      const unreachable = new Set(result.unreachable.map((link) => link.url));
      const kept = sendable.filter((link) => unreachable.has(link.url)).map((link) => ({ ...link.field, refused: true }));
      setFields(kept.length ? kept : [blank()]);
      if (result.accepted.length) {
        setReason("");
        setName("");
        setNotice({ text: "Merci ! Antonin examinera ta proposition.", tone: "ok" });
      } else if (!kept.length) {
        setNotice({ text: "Ces ressources sont déjà dans la veille.", tone: "error" });
      }
    } catch {
      setNotice({ text: FAILED, tone: "error" });
    } finally {
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="vitrine-sheet vitrine-proposal"
      aria-labelledby="vitrine-proposal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={onDialogClick}
    >
      <div className="vitrine-sheet-inner">
        <header className="vitrine-sheet-head">
          <h2 id="vitrine-proposal-title" className="vitrine-sheet-title">
            Proposer une ressource
          </h2>
          <button type="button" className="vitrine-sheet-close" aria-label="Fermer le formulaire" onClick={onClose}>
            ✕
          </button>
        </header>
        <form ref={form} className="vitrine-proposal-form" noValidate onSubmit={onSubmit}>
          {fields.map((field, index) => (
            <div key={field.id} className="vitrine-proposal-field">
              <label htmlFor={`${uid}-link-${field.id}`}>{fields.length > 1 ? `Lien ${index + 1}` : "Lien"}</label>
              <div className="vitrine-proposal-line">
                <input
                  id={`${uid}-link-${field.id}`}
                  data-link=""
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  placeholder="https://…"
                  value={field.value}
                  aria-invalid={field.refused || statuses[index].kind === "invalid" || undefined}
                  aria-describedby={`${uid}-link-${field.id}-note`}
                  onChange={(event) => edit(field.id, event.target.value)}
                />
                {fields.length > 1 ? (
                  <button
                    type="button"
                    className="vitrine-proposal-remove"
                    aria-label={`Retirer le lien ${index + 1}`}
                    onClick={() => removeField(field.id)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              <LinkNote id={`${uid}-link-${field.id}-note`} status={statuses[index]} refused={field.refused} onSee={onSee} />
            </div>
          ))}
          {fields.length < PROPOSAL_LINKS_MAX ? (
            <button type="button" className="vitrine-proposal-add" onClick={addField}>
              + Ajouter un lien
            </button>
          ) : null}
          <label htmlFor="vitrine-proposal-reason">Pourquoi cet outil ? (facultatif)</label>
          <textarea
            id="vitrine-proposal-reason"
            rows={3}
            maxLength={PROPOSAL_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label htmlFor="vitrine-proposal-name">Ton prénom (facultatif)</label>
          <input
            id="vitrine-proposal-name"
            type="text"
            autoComplete="given-name"
            maxLength={PROPOSAL_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {/* Piège à robots : hors de l'écran, hors du clavier, tu aux lecteurs d'écran. */}
          <div className="vitrine-trap" aria-hidden="true">
            <label htmlFor="vitrine-proposal-website">Site web, ne pas remplir</label>
            <input
              id="vitrine-proposal-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>
          <div className="vitrine-proposal-send">
            <button type="submit" className="vitrine-proposal-submit" disabled={sending}>
              {sending ? "Envoi…" : "Envoyer"}
            </button>
            <p className="vitrine-proposal-notice" role="status" data-tone={notice?.tone}>
              {notice?.text}
            </p>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function LinkNote({ id, status, refused, onSee }: { id: string; status: LinkStatus; refused: boolean; onSee: (slug: string) => void }) {
  if (refused) return <Note id={id} tone="error" text={UNREACHABLE} />;
  switch (status.kind) {
    case "empty":
      return <p id={id} className="vitrine-proposal-note" />;
    case "invalid":
      return <Note id={id} tone="error" text={status.error} />;
    case "repeat":
      return <Note id={id} tone="info" text="Lien déjà saisi plus haut : il ne compte qu'une fois." />;
    case "duplicate":
      return (
        <p id={id} className="vitrine-proposal-note" data-tone="info">
          Déjà dans la veille : {status.title || "Sans titre"}{" "}
          <button type="button" className="vitrine-proposal-see" onClick={() => onSee(status.slug)}>
            voir
          </button>
        </p>
      );
    case "ok":
      return (
        <p id={id} className="vitrine-proposal-note" data-tone="ok">
          <span aria-hidden="true">✓</span>
          <span className="sr-only"> Adresse valide</span>
        </p>
      );
  }
}

function Note({ id, tone, text }: { id: string; tone: "error" | "info"; text: string }) {
  return (
    <p id={id} className="vitrine-proposal-note" data-tone={tone}>
      {text}
    </p>
  );
}

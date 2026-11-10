"use client";
// Contenu en ligne « mention » de l'éditeur : favicon du site, titre, lien
// ouvert dans un nouvel onglet. Le même contenu est rendu en HTML par
// lib/blocks.ts pour la lecture seule.
import { createReactInlineContentSpec } from "@blocknote/react";
import { safeHref } from "@/lib/blocks";
import { mentionProps } from "@/lib/mention";
import { domainOf } from "@/lib/unfurl";
import { SiteIcon } from "./SiteIcon";

export const mentionSpec = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const mention = mentionProps(inlineContent.props);
      if (!mention) return <span />;
      const label = mention.title || domainOf(mention.url);
      const href = safeHref(mention.url);
      if (!href) {
        return (
          <span className="mention">
            <SiteIcon url={mention.url} />
            <span className="mention-title">{label}</span>
          </span>
        );
      }
      return (
        <a className="mention" href={href} target="_blank" rel="noreferrer" contentEditable={false} title={mention.url}>
          <SiteIcon url={mention.url} />
          <span className="mention-title">{label}</span>
        </a>
      );
    },
  },
);

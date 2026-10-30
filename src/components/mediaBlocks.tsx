"use client";
// Bloc maison « youtube » : la vidéo reste chez YouTube, la page ne garde que
// le lien. Les PDF passent par le bloc « file » natif de BlockNote, les images
// par son bloc « image ».
import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { youtubeEmbedUrl, youtubeId } from "@/lib/youtube";

export const youtubeBlock = createReactBlockSpec(
  {
    type: "youtube",
    propSchema: { url: { default: "" } },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const id = youtubeId(block.props.url);
      if (id) {
        return (
          <div className="yt-embed" contentEditable={false}>
            <iframe
              src={youtubeEmbedUrl(id)}
              title="Vidéo YouTube"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        );
      }
      return (
        <YoutubeUrlForm
          editable={editor.isEditable}
          onSubmit={(url) => editor.updateBlock(block, { props: { url } })}
        />
      );
    },
  },
);

function YoutubeUrlForm({ editable, onSubmit }: { editable: boolean; onSubmit: (url: string) => void }) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  if (!editable) return <p className="yt-empty">Vidéo YouTube sans lien</p>;
  return (
    <form
      className="yt-form"
      contentEditable={false}
      onSubmit={(event) => {
        event.preventDefault();
        if (youtubeId(value)) onSubmit(value.trim());
        else setInvalid(true);
      }}
    >
      <input
        type="url"
        placeholder="Coller le lien d'une vidéo YouTube"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
      />
      <button type="submit">Intégrer</button>
      {invalid && <span className="yt-error">Ce lien n&apos;est pas celui d&apos;une vidéo YouTube.</span>}
    </form>
  );
}

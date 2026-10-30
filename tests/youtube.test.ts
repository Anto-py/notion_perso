import { describe, expect, it } from "vitest";
import { youtubeEmbedUrl, youtubeId, youtubeOEmbedUrl } from "@/lib/youtube";

describe("youtubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("reconnaît %s", (url, id) => {
    expect(youtubeId(url)).toBe(id);
  });

  it.each([
    "https://vimeo.com/123",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=trop_court",
    "pas une url",
  ])("refuse %s", (url) => {
    expect(youtubeId(url)).toBeNull();
  });
});

it("intègre par youtube-nocookie", () => {
  expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
});

it("demande l'aperçu à oEmbed avec l'identifiant vérifié", () => {
  expect(youtubeOEmbedUrl("dQw4w9WgXcQ")).toBe(
    "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json",
  );
});

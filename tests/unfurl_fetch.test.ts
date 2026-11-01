import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteImage, UNFURL_IMAGE_MAX_BYTES } from "@/lib/unfurl_fetch";

function imageResponse(bytes: Uint8Array<ArrayBuffer>, type = "image/png"): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": type, "content-length": String(bytes.byteLength) } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRemoteImage", () => {
  it("télécharge une image admise et rend son type et son extension", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(bytes, "image/png; charset=binary"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toEqual({ bytes, mime: "image/png", ext: "png" });
  });

  it("refuse une adresse que le serveur ne peut pas ouvrir, sans requête", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRemoteImage("http://127.0.0.1/og.png")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un type qui n'est pas une image admise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(new Uint8Array([1]), "image/svg+xml")));
    await expect(fetchRemoteImage("https://exemple.org/og.svg")).resolves.toBeNull();
  });

  it("refuse une image plus lourde que la limite, sans la lire", async () => {
    const headers = { "content-type": "image/jpeg", "content-length": String(UNFURL_IMAGE_MAX_BYTES + 1) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers })));
    await expect(fetchRemoteImage("https://exemple.org/og.jpg")).resolves.toBeNull();
  });

  it("suit une redirection publique, refuse une redirection vers le réseau interne", async () => {
    const bytes = new Uint8Array([1, 2]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.exemple.org/og.png" } }))
      .mockResolvedValueOnce(imageResponse(bytes));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toMatchObject({ ext: "png" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })),
    );
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
  });

  it("rend null sur une erreur HTTP ou une panne réseau", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau")));
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
  });
});

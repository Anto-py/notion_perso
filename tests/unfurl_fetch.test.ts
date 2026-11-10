import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { fetchRemoteImage, unfurl, UNFURL_IMAGE_MAX_BYTES } from "@/lib/unfurl_fetch";

// unfurl_fetch passe par le fetch d'undici (garde DNS à la connexion), pas par
// le fetch global : c'est lui qu'on intercepte.
const undiciFetch = vi.hoisted(() => vi.fn());
vi.mock("undici", async (original) => ({ ...(await original<typeof import("undici")>()), fetch: undiciFetch }));

function stubFetch(mock: Mock): void {
  undiciFetch.mockImplementation((...args: unknown[]) => mock(...args));
}

function imageResponse(bytes: Uint8Array<ArrayBuffer>, type = "image/png"): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": type, "content-length": String(bytes.byteLength) } });
}

afterEach(() => {
  undiciFetch.mockReset();
});

describe("fetchRemoteImage", () => {
  it("télécharge une image admise et rend son type et son extension", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(bytes, "image/png; charset=binary"));
    stubFetch(fetchMock);
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toEqual({ bytes, mime: "image/png", ext: "png" });
  });

  it("refuse une adresse que le serveur ne peut pas ouvrir, sans requête", async () => {
    const fetchMock = vi.fn();
    stubFetch(fetchMock);
    await expect(fetchRemoteImage("http://127.0.0.1/og.png")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un type qui n'est pas une image admise", async () => {
    stubFetch(vi.fn().mockResolvedValue(imageResponse(new Uint8Array([1]), "image/svg+xml")));
    await expect(fetchRemoteImage("https://exemple.org/og.svg")).resolves.toBeNull();
  });

  it("refuse une image plus lourde que la limite, sans la lire", async () => {
    const headers = { "content-type": "image/jpeg", "content-length": String(UNFURL_IMAGE_MAX_BYTES + 1) };
    stubFetch(vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200, headers })));
    await expect(fetchRemoteImage("https://exemple.org/og.jpg")).resolves.toBeNull();
  });

  it("suit une redirection publique, refuse une redirection vers le réseau interne", async () => {
    const bytes = new Uint8Array([1, 2]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.exemple.org/og.png" } }))
      .mockResolvedValueOnce(imageResponse(bytes));
    stubFetch(fetchMock);
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toMatchObject({ ext: "png" });

    stubFetch(
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })),
    );
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
  });

  it("rend null sur une erreur HTTP ou une panne réseau", async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
    stubFetch(vi.fn().mockRejectedValue(new Error("réseau")));
    await expect(fetchRemoteImage("https://exemple.org/og.png")).resolves.toBeNull();
  });
});

describe("garde des adresses littérales", () => {
  // Node ne consulte pas le DNS pour une adresse IP écrite dans l'URL : la
  // garde à la connexion ne la verrait pas, d'où ce contrôle avant l'envoi.
  it.each(["http://100.64.0.1/og.png", "http://[::ffff:7f00:1]/og.png", "http://[::ffff:127.0.0.1]/og.png"])(
    "refuse %s sans requête",
    async (url) => {
      const fetchMock = vi.fn();
      stubFetch(fetchMock);
      await expect(fetchRemoteImage(url)).resolves.toBeNull();
      await expect(unfurl(url)).resolves.toMatchObject({ reached: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuse une redirection vers une adresse littérale privée", async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { location: "http://100.64.0.1/" } })));
    await expect(unfurl("https://exemple.org/")).resolves.toMatchObject({ reached: false });
  });

  it("passe la garde DNS à chaque requête", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse(new Uint8Array([1])));
    stubFetch(fetchMock);
    await fetchRemoteImage("https://exemple.org/og.png");
    expect(fetchMock.mock.calls[0][1]).toHaveProperty("dispatcher");
  });
});

describe("unfurl, reached", () => {
  function page(html: string, type = "text/html; charset=utf-8"): Response {
    return new Response(html, { status: 200, headers: { "content-type": type } });
  }

  it("vrai sur une page 2xx, avec ses métadonnées", async () => {
    stubFetch(vi.fn().mockResolvedValue(page("<title>Mindmup</title>")));
    await expect(unfurl("https://www.mindmup.com/")).resolves.toMatchObject({ title: "Mindmup", reached: true });
  });

  it("vrai sur une réponse 2xx d'un autre type, titre replié sur le domaine", async () => {
    stubFetch(vi.fn().mockResolvedValue(page("%PDF", "application/pdf")));
    await expect(unfurl("https://exemple.org/doc.pdf")).resolves.toMatchObject({ title: "exemple.org", reached: true });
  });

  it("vrai après une redirection publique suivie", async () => {
    stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://exemple.org/fr" } }))
        .mockResolvedValueOnce(page("<title>Accueil</title>")),
    );
    await expect(unfurl("https://exemple.org/")).resolves.toMatchObject({ reached: true });
  });

  it("faux sur une erreur HTTP, une panne réseau ou une adresse refusée", async () => {
    stubFetch(vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(unfurl("https://exemple.org/")).resolves.toMatchObject({ reached: false });
    stubFetch(vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(unfurl("https://exemple.org/")).resolves.toMatchObject({ reached: false });
    await expect(unfurl("http://localhost:3021/")).resolves.toMatchObject({ reached: false });
  });
});

describe("fetchRemoteImage, allowIcon", () => {
  const ico = new Uint8Array([0, 0, 1, 0]);

  it("refuse une icône .ico par défaut", async () => {
    stubFetch(vi.fn().mockResolvedValue(imageResponse(ico, "image/x-icon")));
    await expect(fetchRemoteImage("https://exemple.org/favicon.ico")).resolves.toBeNull();
  });

  it.each(["image/x-icon", "image/vnd.microsoft.icon"])("admet %s avec allowIcon", async (type) => {
    stubFetch(vi.fn().mockResolvedValue(imageResponse(ico, type)));
    await expect(fetchRemoteImage("https://exemple.org/favicon.ico", { allowIcon: true })).resolves.toEqual({
      bytes: ico,
      mime: type,
      ext: "ico",
    });
  });

  it("refuse toujours le SVG, même avec allowIcon", async () => {
    stubFetch(vi.fn().mockResolvedValue(imageResponse(new Uint8Array([60]), "image/svg+xml")));
    await expect(fetchRemoteImage("https://exemple.org/logo.svg", { allowIcon: true })).resolves.toBeNull();
  });

  it("garde les images ordinaires avec allowIcon", async () => {
    stubFetch(vi.fn().mockResolvedValue(imageResponse(new Uint8Array([137, 80]))));
    await expect(fetchRemoteImage("https://exemple.org/apple-touch-icon.png", { allowIcon: true })).resolves.toMatchObject({
      ext: "png",
    });
  });
});

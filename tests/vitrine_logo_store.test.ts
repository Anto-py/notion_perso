import { mkdtemp, readdir, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_DIR, LOGO_FRESH_MS } from "@/lib/vitrine_logo";
import { vitrineLogo } from "@/lib/vitrine_logo_store";

// Le réseau est simulé : seule compte la façon dont le stockage s'en sert.
const net = vi.hoisted(() => ({ fetchPage: vi.fn(), fetchRemoteImage: vi.fn() }));
vi.mock("@/lib/unfurl_fetch", () => net);

const PNG = { bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png", ext: "png" };
const ICO = { bytes: new Uint8Array([0, 0, 1, 0]), mime: "image/vnd.microsoft.icon", ext: "ico" };
const HOME = "https://www.mindmup.com/";

let root: string;
const logos = () => path.join(root, LOGO_DIR);
const files = async () => (await readdir(logos())).sort();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vitrine-logo-"));
  vi.stubEnv("UPLOAD_DIR", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  net.fetchPage.mockReset();
  net.fetchRemoteImage.mockReset();
  await rm(root, { recursive: true, force: true });
});

describe("vitrineLogo", () => {
  it("télécharge le premier candidat obtenu, l'écrit, puis le sert sans réseau", async () => {
    net.fetchPage.mockResolvedValue({ url: HOME, html: `<link rel="apple-touch-icon" href="/apple.png">` });
    net.fetchRemoteImage.mockImplementation(async (url: string) => (url.endsWith("/apple.png") ? PNG : null));

    await expect(vitrineLogo("mindmup.com", HOME)).resolves.toEqual({ bytes: PNG.bytes, mime: "image/png" });
    expect(net.fetchRemoteImage).toHaveBeenCalledWith("https://www.mindmup.com/apple.png", { allowIcon: true });
    expect(await files()).toEqual(["mindmup.com.png"]);

    net.fetchPage.mockClear();
    net.fetchRemoteImage.mockClear();
    await expect(vitrineLogo("mindmup.com", HOME)).resolves.toEqual({ bytes: PNG.bytes, mime: "image/png" });
    expect(net.fetchPage).not.toHaveBeenCalled();
    expect(net.fetchRemoteImage).not.toHaveBeenCalled();
  });

  it("ne fait qu'un téléchargement pour 20 appels simultanés", async () => {
    net.fetchPage.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { url: HOME, html: "" };
    });
    net.fetchRemoteImage.mockResolvedValue(PNG);

    const results = await Promise.all(Array.from({ length: 20 }, () => vitrineLogo("mindmup.com", HOME)));
    expect(results.every((logo) => logo?.mime === "image/png")).toBe(true);
    expect(net.fetchPage).toHaveBeenCalledTimes(1);
    expect(net.fetchRemoteImage).toHaveBeenCalledTimes(1);
  });

  it("sert un site à favicon.ico seul en image/x-icon", async () => {
    net.fetchPage.mockResolvedValue({ url: HOME, html: "<title>Sans icône</title>" });
    net.fetchRemoteImage.mockImplementation(async (url: string) => (url === "https://www.mindmup.com/favicon.ico" ? ICO : null));

    await expect(vitrineLogo("mindmup.com", HOME)).resolves.toEqual({ bytes: ICO.bytes, mime: "image/x-icon" });
    expect(await files()).toEqual(["mindmup.com.ico"]);
  });

  it("note une absence dans <host>.none, puis ne retourne plus sur le réseau", async () => {
    net.fetchPage.mockResolvedValue(null);
    net.fetchRemoteImage.mockResolvedValue(null);

    await expect(vitrineLogo("mindmup.com", HOME)).resolves.toBeNull();
    expect(net.fetchRemoteImage).toHaveBeenCalledWith("https://www.mindmup.com/favicon.ico", { allowIcon: true });
    expect(await files()).toEqual(["mindmup.com.none"]);

    net.fetchPage.mockClear();
    await expect(vitrineLogo("mindmup.com", HOME)).resolves.toBeNull();
    expect(net.fetchPage).not.toHaveBeenCalled();
  });

  it("essaie au plus quatre candidats, /favicon.ico toujours compris", async () => {
    const html = [1, 2, 3, 4, 5].map((n) => `<link rel="icon" href="/i${n}.png">`).join("");
    net.fetchPage.mockResolvedValue({ url: HOME, html });
    net.fetchRemoteImage.mockResolvedValue(null);

    await vitrineLogo("mindmup.com", HOME);
    expect(net.fetchRemoteImage.mock.calls.map(([url]) => url)).toEqual([
      "https://www.mindmup.com/i1.png",
      "https://www.mindmup.com/i2.png",
      "https://www.mindmup.com/i3.png",
      "https://www.mindmup.com/favicon.ico",
    ]);
  });

  describe("après 30 jours", () => {
    const old = new Date(Date.now() - LOGO_FRESH_MS - 60_000);

    async function seed(name: string, bytes: Uint8Array = new Uint8Array()): Promise<void> {
      await mkdir(logos(), { recursive: true });
      await writeFile(path.join(logos(), name), bytes);
      await utimes(path.join(logos(), name), old, old);
    }

    it("remplace une absence par le logo trouvé", async () => {
      await seed("mindmup.com.none");
      net.fetchPage.mockResolvedValue({ url: HOME, html: "" });
      net.fetchRemoteImage.mockResolvedValue(PNG);

      await expect(vitrineLogo("mindmup.com", HOME)).resolves.toEqual({ bytes: PNG.bytes, mime: "image/png" });
      expect(await files()).toEqual(["mindmup.com.png"]);
    });

    it("garde l'ancien logo quand la relecture ne trouve rien, et le rajeunit", async () => {
      await seed("mindmup.com.ico", ICO.bytes);
      net.fetchPage.mockResolvedValue(null);
      net.fetchRemoteImage.mockResolvedValue(null);

      await expect(vitrineLogo("mindmup.com", HOME)).resolves.toEqual({ bytes: ICO.bytes, mime: "image/x-icon" });
      expect(await files()).toEqual(["mindmup.com.ico"]);
      const { mtimeMs } = await stat(path.join(logos(), "mindmup.com.ico"));
      expect(Date.now() - mtimeMs).toBeLessThan(60_000);
    });

    it("remplace un logo d'un autre format", async () => {
      await seed("mindmup.com.ico", ICO.bytes);
      net.fetchPage.mockResolvedValue({ url: HOME, html: "" });
      net.fetchRemoteImage.mockResolvedValue(PNG);

      await vitrineLogo("mindmup.com", HOME);
      expect(await files()).toEqual(["mindmup.com.png"]);
    });
  });
});

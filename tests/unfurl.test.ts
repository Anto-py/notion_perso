import { describe, expect, it } from "vitest";
import { decodeEntities, domainOf, faviconUrl, isFetchableUrl, parseUnfurl } from "@/lib/unfurl";

describe("isFetchableUrl", () => {
  it("accepte le web public en http et https", () => {
    expect(isFetchableUrl("https://exemple.org/article")).toBe(true);
    expect(isFetchableUrl("http://exemple.org")).toBe(true);
    expect(isFetchableUrl("https://8.8.8.8/page")).toBe(true);
  });

  it("refuse un autre schéma, des identifiants ou une adresse illisible", () => {
    expect(isFetchableUrl("ftp://exemple.org")).toBe(false);
    expect(isFetchableUrl("javascript:alert(1)")).toBe(false);
    expect(isFetchableUrl("https://user:secret@exemple.org")).toBe(false);
    expect(isFetchableUrl("pas une url")).toBe(false);
  });

  it("refuse le réseau interne, y compris le service de métadonnées", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.0.0.2",
      "http://192.168.1.10",
      "http://172.16.0.1",
      "http://172.31.255.1",
      "http://169.254.169.254/latest/meta-data",
      "http://intranet",
      "http://[::1]",
    ]) {
      expect(isFetchableUrl(url), url).toBe(false);
    }
    expect(isFetchableUrl("http://172.32.0.1")).toBe(true);
  });
});

describe("domainOf", () => {
  it("retire www et garde l'hôte", () => {
    expect(domainOf("https://www.exemple.org/a/b")).toBe("exemple.org");
    expect(domainOf("https://exemple.org")).toBe("exemple.org");
    expect(domainOf("pas une url")).toBe("pas une url");
  });
});

describe("faviconUrl", () => {
  it("vise le favicon servi par le site, quel que soit le chemin de la page", () => {
    expect(faviconUrl("https://fr.wikipedia.org/wiki/Notion_(logiciel)")).toBe("https://fr.wikipedia.org/favicon.ico");
    expect(faviconUrl("http://exemple.org:8080/a/b")).toBe("http://exemple.org:8080/favicon.ico");
  });

  it("ne propose rien pour une URL illisible ou hors du web", () => {
    expect(faviconUrl("pas une url")).toBeNull();
    expect(faviconUrl("mailto:contact@exemple.org")).toBeNull();
  });
});

describe("parseUnfurl", () => {
  const html = `<!doctype html><html><head>
    <title>Titre de secours</title>
    <meta property="og:title" content="Le vrai titre" />
    <meta name="description" content="Une description classique" />
    <meta property="og:description" content="Aperçu &amp; détail" />
    <meta property="og:image" content="/image.png" />
    <meta property="og:site_name" content="Exemple" />
  </head><body></body></html>`;

  it("préfère Open Graph et résout l'image relative", () => {
    expect(parseUnfurl(html, "https://exemple.org/article")).toEqual({
      title: "Le vrai titre",
      description: "Aperçu & détail",
      image: "https://exemple.org/image.png",
      site: "Exemple",
    });
  });

  it("retombe sur <title> et sur la description classique", () => {
    const result = parseUnfurl(
      `<meta name='description' content='Simple'><title>  Titre\n  sur deux lignes </title>`,
      "https://exemple.org",
    );
    expect(result).toEqual({ title: "Titre sur deux lignes", description: "Simple", image: null, site: "" });
  });

  it("retombe sur le domaine quand la page ne dit rien", () => {
    expect(parseUnfurl("<html><head></head></html>", "https://www.exemple.org/a")).toEqual({
      title: "exemple.org",
      description: "",
      image: null,
      site: "",
    });
  });

  it("refuse une image qui n'est pas du web", () => {
    expect(parseUnfurl(`<meta property="og:image" content="data:image/png;base64,xxx">`, "https://exemple.org").image).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("décode les entités nommées, décimales et hexadécimales", () => {
    expect(decodeEntities("&lt;b&gt; &amp; &#39;x&#39; &#x2014;")).toBe("<b> & 'x' —");
  });
});

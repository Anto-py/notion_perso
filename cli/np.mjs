#!/usr/bin/env node
// np : la porte de notion_perso pour un agent du harnais (SPECS.md, « Accès
// agent », « Commande np »). Node 22, sans dépendance : le serveur convertit,
// np ne fait que parler HTTP, lire et écrire des fichiers.
//
// Jeton : trousseau macOS (service notion-perso-agent), jamais affiché ;
// NP_JETON le remplace pour un essai contre une instance locale.
// Serveur : --serveur ou NP_SERVEUR (défaut : production).
// Modèle déclaré au journal : --modele ou NP_AGENT_MODELE.
// Sortie : 0 succès, 1 refus du serveur, 2 erreur d'usage, 3 en attente de
// validation.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const DEFAULT_SERVER = "https://notion.antoninbareau.eu";
const KEYCHAIN_SERVICE = "notion-perso-agent";
const VALUE_OPTIONS = new Set(["--vers", "--medias", "--modele", "--serveur", "--sous", "--titre", "--nombre"]);
const FLAG_OPTIONS = new Set(["--json", "--aide", "-h", "--help"]);

const HELP = `np, accès agent à notion_perso

Lecture
  np chercher <mots…>                  pages qui contiennent ces mots (chemin, id, extrait)
  np lister [chemin|id]                enfants d'une page, entrées d'une base ; racines sans argument
  np lire <chemin|id> [--vers fichier] [--medias dossier]
                                       page en Markdown (base : schéma puis tableau ; entrée : front matter
                                       des valeurs) ; --medias télécharge les images et PDF cités
  np vide-cerveau --vers <dossier>     copie datée du Vide-cerveau, sans rien y supprimer

Écriture (jamais de remplacement : on ajoute en bas)
  np creer <fichier.md|-> [--sous chemin|id] [--titre t]   nouvelle page (titre : --titre, sinon le premier « # », sinon le nom du fichier)
  np ajouter <chemin|id> <fichier.md|->                     ajoute le Markdown au bas de la page
  np entree <base> <fichier.md|->                           nouvelle entrée : propriétés du front matter, titre du « # », corps du reste
  np modifier <entrée> Nom=valeur …                         valeurs d'une entrée (Sélection par nom, Date AAAA-MM-JJ,
                                                            Case oui/non, Relation par titres, Nom= pour effacer)
  np renommer <chemin|id> <titre…>
  np deplacer <chemin|id> <destination|/>                   « / » : racine de l'arbre
  np icone <chemin|id> <emoji|aucune>
  np corbeille <chemin|id>
  np restaurer <id>                                         une page en corbeille n'a plus de chemin : son id
  np publier <chemin|id>                                    demande de publication, validée dans Réglages › Agent
  np purger <id>                                            demande de suppression définitive (page en corbeille)
  np depublier <chemin|id>                                  dépublie aussitôt
  np journal [--nombre n]                                   dernières écritures des agents

Le front matter d'un fichier est ignoré, sauf pour « np entree ». Conversions et éléments ignorés
sont signalés sur stderr. Une image ou un PDF seul sur sa ligne, chemin local, est téléversé avant
l'envoi du corps ; un type refusé reste un lien texte signalé.

Chemin : titres séparés par « / », sans accents ni casse (« Projets/Linux »). Un chemin
qui ne part pas d'une racine vaut pour la fin d'un chemin (« To Do »). « \\/ » dans un titre.

Options : --json (réponse brute), --modele <nom>, --serveur <adresse>
Environnement : NP_SERVEUR, NP_AGENT_MODELE, NP_JETON (essai local)
Sortie : 0 succès, 1 refus du serveur, 2 erreur d'usage, 3 en attente de validation`;

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const usage = (message) => new Exit(2, message);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      if (i + 1 >= argv.length) throw usage(`${arg} attend une valeur`);
      options[arg.slice(2)] = argv[++i];
    } else if (FLAG_OPTIONS.has(arg)) {
      options[arg === "-h" || arg === "--help" ? "aide" : arg.slice(2)] = true;
    } else if (arg.startsWith("--")) {
      throw usage(`Option inconnue : ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function readToken() {
  if (process.env.NP_JETON) return process.env.NP_JETON.trim();
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw usage(`Jeton introuvable dans le trousseau (service ${KEYCHAIN_SERVICE}) : créez-le dans Réglages › Agent.`);
  }
}

function client(options) {
  const server = (options.serveur || process.env.NP_SERVEUR || DEFAULT_SERVER).replace(/\/+$/, "");
  const model = options.modele || process.env.NP_AGENT_MODELE || "";
  const token = readToken();
  const auth = () => {
    const headers = { Authorization: `Bearer ${token}` };
    if (model) headers["X-Agent-Model"] = model;
    return headers;
  };
  const send = async (path, init) => {
    try {
      return await fetch(`${server}${path}`, init);
    } catch (error) {
      throw new Exit(1, `Serveur injoignable (${server}) : ${error.cause?.code ?? error.message}`);
    }
  };
  const refuse = (response, data) => {
    let message = data.error || `Réponse ${response.status}`;
    if (Array.isArray(data.candidates)) {
      message += ", précisez le chemin ou donnez l'id :\n" + data.candidates.map((c) => `  ${c.path}  (${c.type}, ${c.id})`).join("\n");
    }
    return new Exit(1, message);
  };

  // JSON : la forme de toutes les routes sauf le téléversement et le
  // téléchargement d'un média.
  const call = async (path, method = "GET", body = undefined) => {
    const headers = auth();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    throw refuse(response, data);
  };

  // Multipart : le navigateur (Node) pose lui-même la frontière.
  call.form = async (path, form) => {
    const response = await send(path, { method: "POST", headers: auth(), body: form });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    throw refuse(response, data);
  };

  // Octets bruts d'un média.
  call.raw = async (path) => {
    const response = await send(path, { headers: auth() });
    if (response.ok) return response;
    throw refuse(response, await response.json().catch(() => ({})));
  };

  return call;
}

// Même forme que lib/page_path.ts, looksLikeId.
function looksLikeId(text) {
  return /^[a-z]{2}_[A-Za-z0-9_-]{16}$/.test(text.trim());
}

async function resolveId(call, target) {
  if (looksLikeId(target)) return target.trim();
  const { id } = await call(`/api/agent/pages?path=${encodeURIComponent(target)}`);
  return id;
}

function print(text) {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

const KIND = { page: "page", database: "base", entry: "entrée", folder: "dossier" };

function childLine(child) {
  const count = child.children ? `, ${child.children} ${child.type === "database" ? "entrée(s)" : "enfant(s)"}` : "";
  return `[${KIND[child.type] ?? child.type}] ${child.title || "Sans titre"} (${child.id}${count})`;
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Un fichier existant n'est jamais écrasé : vide_cerveau_<date>_2.md, _3…
function freeName(dir, base) {
  let name = `${base}.md`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${base}_${n}.md`;
  return join(dir, name);
}

// Fichier ou entrée standard : « - », ou rien du tout quand l'entrée est piped.
function readSource(source) {
  if (!source || source === "-") {
    if (!source && process.stdin.isTTY) throw usage("Fichier Markdown attendu (ou « - » pour l'entrée standard)");
    return { text: readFileSync(0, "utf8"), name: null, dir: process.cwd() };
  }
  const file = resolve(source);
  if (!existsSync(file) || !statSync(file).isFile()) throw usage(`${file} n'est pas un fichier.`);
  return { text: readFileSync(file, "utf8"), name: basename(file).replace(/\.md$/i, ""), dir: dirname(file) };
}

// Types admis par lib/upload_rules.ts, extension vers type MIME. Le serveur
// revérifie ; ici c'est ce qui permet de composer le multipart.
const MEDIA_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
};

function mediaMime(file) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_MIME[ext] ?? null;
}

// Une image ou un PDF seul sur sa ligne, dont la cible est un chemin local :
// ce que `np` téléverse avant l'envoi du corps. Un lien ordinaire vers un PDF
// compte aussi, une image distante ou déjà téléversée non.
function mediaLines(markdown) {
  const found = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const match = /^(\s*)(!?)\[([^\]]*)\]\(([^)\s]+)\)(\s*)$/.exec(line);
    if (!match) return;
    const [, indent, bang, label, href, tail] = match;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return;
    if (!bang && !/\.pdf(?:[?#]|$)/i.test(href)) return;
    found.push({ index, indent, bang, label, href, tail });
  });
  return found;
}

// Téléverse chaque média local et réécrit son lien. Une erreur du serveur
// interrompt avant que le corps ne parte : rien n'est écrit. Un fichier absent
// ou d'un type refusé reste un lien texte, et le dit.
async function uploadLocalMedia(call, markdown, baseDir, pageId) {
  const entries = mediaLines(markdown);
  if (!entries.length) return { markdown, uploaded: 0 };
  const lines = markdown.split(/\r?\n/);
  let uploaded = 0;
  for (const entry of entries) {
    let path = entry.href.split(/[?#]/)[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      // Un % isolé reste tel quel.
    }
    const file = resolve(baseDir, path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      process.stderr.write(`Média introuvable, laissé en lien : ${entry.href}\n`);
      continue;
    }
    const mime = mediaMime(file);
    if (!mime) {
      process.stderr.write(`Format refusé, laissé en lien : ${entry.href}\n`);
      continue;
    }
    const form = new FormData();
    form.append("file", new File([readFileSync(file)], basename(file), { type: mime }));
    if (pageId) form.append("pageId", pageId);
    const data = await call.form("/api/agent/media", form);
    lines[entry.index] = `${entry.indent}${entry.bang}[${entry.label}](${data.url})${entry.tail}`;
    process.stderr.write(`Téléversé : ${entry.href} → ${data.url}\n`);
    uploaded++;
  }
  return { markdown: lines.join("\n"), uploaded };
}

// Médias cités par la page, adresse absolue ou relative.
const MEDIA_URL = /(?:https?:\/\/[^\s/)]+)?\/api\/media\/(up_[A-Za-z0-9_-]{16}\.[a-z0-9]+)/g;

// `np lire --medias` : chaque média cité est retéléchargé dans le dossier, et
// le lien réécrit vers le fichier local, relatif au Markdown écrit ou au
// dossier courant.
async function downloadMedia(call, markdown, dir, baseDir) {
  const names = [...new Set([...markdown.matchAll(MEDIA_URL)].map((match) => match[1]))];
  if (!names.length) return markdown;
  const local = new Map();
  for (const name of names) {
    const response = await call.raw(`/api/agent/media/${encodeURIComponent(name)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = join(dir, name);
    writeFileSync(file, bytes);
    local.set(name, relative(baseDir, file) || name);
    process.stderr.write(`Téléchargé : ${name} (${bytes.length} octets)\n`);
  }
  return markdown.replace(MEDIA_URL, (match, name) => local.get(name) ?? match);
}

// YAML simple du front matter : scalaires (guillemets doubles relus) et listes
// en « - item ». Une clé sans valeur ni liste est ignorée.
function frontScalar(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((item) => frontScalar(item));
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseFrontMatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!match) return { values: {}, rest: text };
  const values = {};
  let key = null;
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && key !== null) {
      if (!Array.isArray(values[key])) values[key] = [];
      values[key].push(frontScalar(item[1]));
      continue;
    }
    const pair = /^("(?:[^"\\]|\\.)*"|[^:]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = frontScalar(pair[1]);
    values[key] = pair[2].trim() === "" ? [] : frontScalar(pair[2]);
  }
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value) && value.length === 0) delete values[name];
  }
  return { values, rest: text.slice(match[0].length) };
}

// Le front matter d'une note du vault n'a pas sa place dans une page : il est
// retiré, et signalé.
function stripFrontMatter(text) {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!match) return text;
  process.stderr.write("Front matter ignoré.\n");
  return text.slice(match[0].length);
}

// Premier « # Titre » du fichier, s'il ouvre le texte : il devient le titre de
// la page et quitte le corps.
function takeTitle(text) {
  const match = /^\s*# +(.+?)\s*(\r?\n|$)/.exec(text);
  return match ? { title: match[1], rest: text.slice(match[0].length) } : { title: null, rest: text };
}

function report(result) {
  for (const line of result.converted ?? []) process.stderr.write(`Converti : ${line}\n`);
  for (const line of result.ignored ?? []) process.stderr.write(`Ignoré : ${line}\n`);
}

async function target(call, args, label) {
  const value = (args[0] ?? "").trim();
  if (!value) throw usage(label);
  return resolveId(call, value);
}

const COMMANDS = {
  async chercher(call, args, options) {
    const query = args.join(" ").trim();
    if (!query) throw usage("np chercher <mots…>");
    const data = await call(`/api/agent/search?q=${encodeURIComponent(query)}`);
    if (options.json) return print(JSON.stringify(data, null, 2));
    if (!data.results.length) return print("Aucun résultat.");
    print(data.results.map((hit) => `${hit.path} (${KIND[hit.type] ?? hit.type}, ${hit.id})\n  ${hit.excerpt}`).join("\n"));
  },

  async lister(call, args, options) {
    const target = args.join(" ").trim();
    const id = target ? await resolveId(call, target) : null;
    const data = await call(id ? `/api/agent/pages?parent=${encodeURIComponent(id)}` : "/api/agent/pages");
    if (options.json) return print(JSON.stringify(data, null, 2));
    if (!data.children.length) return print("Aucun enfant.");
    print(data.children.map(childLine).join("\n"));
  },

  async lire(call, args, options) {
    const target = args.join(" ").trim();
    if (!target) throw usage("np lire <chemin|id> [--vers fichier] [--medias dossier]");
    const file = options.vers ? resolve(options.vers) : null;
    if (file && existsSync(file)) throw usage(`${file} existe déjà : np n'écrase aucun fichier.`);
    const id = await resolveId(call, target);
    const page = await call(`/api/agent/pages/${encodeURIComponent(id)}?format=md`);
    if (page.trashed) process.stderr.write(`Attention : « ${page.path} » est en corbeille.\n`);
    let markdown = page.markdown;
    if (options.medias) {
      const dir = resolve(options.medias);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw usage(`${dir} n'est pas un dossier existant.`);
      markdown = await downloadMedia(call, markdown, dir, file ? dirname(file) : process.cwd());
    }
    if (options.json) return print(JSON.stringify({ ...page, markdown }, null, 2));
    if (!file) return print(markdown);
    writeFileSync(file, markdown);
    print(`${page.path} écrit dans ${file}`);
  },

  async creer(call, args, options) {
    const source = readSource(args[0]);
    const { title, rest } = takeTitle(stripFrontMatter(source.text));
    const parentId = options.sous ? await resolveId(call, options.sous) : null;
    const name = options.titre ?? title ?? (source.name ? source.name.replace(/_/g, " ") : "");
    const prepared = await uploadLocalMedia(call, rest, source.dir, null);
    const result = await call("/api/agent/pages", "POST", { parentId, title: name, markdown: prepared.markdown });
    report(result);
    if (options.json) return print(JSON.stringify(result, null, 2));
    print(`Page créée : « ${name || "Sans titre"} » (${result.id}), ${result.blocks} bloc(s).`);
  },

  async ajouter(call, args, options) {
    if (args.length < 2) throw usage("np ajouter <chemin|id> <fichier.md|->");
    const id = await resolveId(call, args.slice(0, -1).join(" "));
    const source = readSource(args.at(-1));
    const prepared = await uploadLocalMedia(call, stripFrontMatter(source.text), source.dir, id);
    const result = await call(`/api/agent/pages/${encodeURIComponent(id)}/append`, "POST", { markdown: prepared.markdown });
    report(result);
    if (options.json) return print(JSON.stringify(result, null, 2));
    print(`${result.blocks} bloc(s) ajouté(s) au bas de ${id}.`);
  },

  async entree(call, args, options) {
    if (!args.length) throw usage("np entree <base> <fichier.md|->");
    const base = await resolveId(call, args[0]);
    const source = readSource(args[1]);
    const { values, rest } = parseFrontMatter(source.text);
    const heading = takeTitle(rest);
    const name = options.titre ?? heading.title ?? (source.name ? source.name.replace(/_/g, " ") : "");
    const prepared = await uploadLocalMedia(call, heading.rest, source.dir, null);
    const result = await call(`/api/agent/databases/${encodeURIComponent(base)}/entries`, "POST", {
      title: name,
      values,
      markdown: prepared.markdown,
    });
    report(result);
    if (options.json) return print(JSON.stringify(result, null, 2));
    const created = result.created?.length ? ` Options créées : ${result.created.join(" ; ")}.` : "";
    print(`Entrée créée : « ${name || "Sans titre"} » (${result.id}), ${result.blocks} bloc(s).${created}`);
  },

  async modifier(call, args, options) {
    if (args.length < 2) throw usage("np modifier <entrée> Nom=valeur …");
    const id = await resolveId(call, args[0]);
    const values = {};
    for (const pair of args.slice(1)) {
      const at = pair.indexOf("=");
      if (at < 1) throw usage(`Valeur attendue sous la forme Nom=valeur : « ${pair} »`);
      values[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
    }
    const result = await call(`/api/agent/entries/${encodeURIComponent(id)}`, "PATCH", { values });
    if (options.json) return print(JSON.stringify(result, null, 2));
    const created = result.created?.length ? ` Options créées : ${result.created.join(" ; ")}.` : "";
    print(`${id} modifiée (${Object.keys(values).join(", ")}).${created}`);
  },

  async renommer(call, args) {
    if (args.length < 2) throw usage("np renommer <chemin|id> <titre…>");
    const id = await resolveId(call, args[0]);
    const title = args.slice(1).join(" ");
    await call(`/api/agent/pages/${encodeURIComponent(id)}`, "PATCH", { title });
    print(`${id} s'appelle désormais « ${title} ».`);
  },

  async deplacer(call, args) {
    if (args.length !== 2) throw usage("np deplacer <chemin|id> <destination|/>");
    const id = await resolveId(call, args[0]);
    const parentId = args[1].trim() === "/" ? null : await resolveId(call, args[1]);
    await call(`/api/agent/pages/${encodeURIComponent(id)}`, "PATCH", { parentId });
    print(`${id} déplacée ${parentId ? `sous ${parentId}` : "à la racine"}.`);
  },

  async icone(call, args) {
    if (args.length !== 2) throw usage("np icone <chemin|id> <emoji|aucune>");
    const id = await resolveId(call, args[0]);
    const icon = args[1] === "aucune" ? null : args[1];
    await call(`/api/agent/pages/${encodeURIComponent(id)}`, "PATCH", { icon });
    print(icon ? `Icône de ${id} : ${icon}` : `Icône de ${id} retirée.`);
  },

  async corbeille(call, args) {
    const id = await target(call, args, "np corbeille <chemin|id>");
    await call(`/api/agent/pages/${encodeURIComponent(id)}/trash`, "POST", {});
    print(`${id} est en corbeille (np restaurer ${id} pour l'en sortir).`);
  },

  async restaurer(call, args) {
    const id = (args[0] ?? "").trim();
    if (!looksLikeId(id)) throw usage("np restaurer <id> : une page en corbeille n'a plus de chemin, donnez son id.");
    await call(`/api/agent/pages/${encodeURIComponent(id)}/restore`, "POST", {});
    print(`${id} restaurée.`);
  },

  async publier(call, args) {
    const id = await target(call, args, "np publier <chemin|id>");
    const result = await call(`/api/agent/pages/${encodeURIComponent(id)}/publish`, "POST", {});
    if (result.pending) {
      throw new Exit(3, `Publication en attente de validation dans Réglages › Agent (demande ${result.request}).`);
    }
    print(`${id} publiée.`);
  },

  async purger(call, args) {
    const id = (args[0] ?? "").trim();
    if (!looksLikeId(id)) throw usage("np purger <id> : une page en corbeille n'a plus de chemin, donnez son id.");
    const result = await call(`/api/agent/pages/${encodeURIComponent(id)}/purge`, "POST", {});
    if (result.pending) {
      throw new Exit(3, `Purge en attente de validation dans Réglages › Agent (demande ${result.request}).`);
    }
    print(`${id} purgée.`);
  },

  async depublier(call, args) {
    const id = await target(call, args, "np depublier <chemin|id>");
    const result = await call(`/api/agent/pages/${encodeURIComponent(id)}/unpublish`, "POST", {});
    print(result.changed ? `${id} n'est plus publiée.` : `${id} n'était pas publiée.`);
  },

  async journal(call, args, options) {
    const limit = options.nombre ? Number(options.nombre) : 20;
    if (!Number.isInteger(limit) || limit < 1) throw usage("--nombre attend un entier positif");
    const data = await call(`/api/agent/log?limit=${limit}`);
    if (options.json) return print(JSON.stringify(data, null, 2));
    const requests = data.requests ?? [];
    if (!data.entries.length && !requests.length) return print("Journal vide.");
    if (data.entries.length) {
      print(
        data.entries
          .map((e) => `${new Date(e.at).toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" })}  ${e.action}  « ${e.pageTitle || "Sans titre"} »  (${e.model || "modèle non déclaré"}, ${e.tokenName || "jeton supprimé"})`)
          .join("\n"),
      );
    }
    if (requests.length) {
      const lines = requests.map(
        (r) =>
          `  ${r.action === "publish" ? "Publier" : "Purger"}  « ${r.pageTitle || "Sans titre"} »  (${r.id}, ${r.tokenName || "jeton supprimé"}${r.model ? `, ${r.model}` : ""})`,
      );
      print(`${data.entries.length ? "\n" : ""}En attente de validation :\n${lines.join("\n")}`);
    }
  },

  async "vide-cerveau"(call, args, options) {
    if (!options.vers) throw usage("np vide-cerveau --vers <dossier>");
    const dir = resolve(options.vers);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw usage(`${dir} n'est pas un dossier existant.`);
    const inbox = await call("/api/agent/inbox");
    if (options.json) return print(JSON.stringify(inbox, null, 2));
    if (!inbox.count || !inbox.markdown.trim()) return print("Vide-cerveau vide : aucun fichier écrit.");
    const date = today();
    const file = freeName(dir, `vide_cerveau_${date}`);
    const content = `---\ndate_created: ${date}\nsource: notion_perso, Vide-cerveau\n---\n\n# Vide-cerveau du ${date}\n\n${inbox.markdown}`;
    writeFileSync(file, content);
    print(`${inbox.count} capture(s) copiée(s) dans ${file} ; le Vide-cerveau reste intact.`);
  },
};

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const [command, ...args] = positional;
  if (!command || options.aide) return print(HELP);
  const run = COMMANDS[command];
  if (!run) throw usage(`Commande inconnue : ${command}. np --aide pour la liste.`);
  await run(client(options), args, options);
}

main().catch((error) => {
  if (error instanceof Exit) {
    process.stderr.write(`np : ${error.message}\n`);
    process.exit(error.code);
  }
  process.stderr.write(`np : ${error.stack ?? error}\n`);
  process.exit(1);
});

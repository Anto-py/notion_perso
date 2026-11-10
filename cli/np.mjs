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
import { basename, join, resolve } from "node:path";

const DEFAULT_SERVER = "https://notion.antoninbareau.eu";
const KEYCHAIN_SERVICE = "notion-perso-agent";
const VALUE_OPTIONS = new Set(["--vers", "--modele", "--serveur", "--sous", "--titre", "--nombre"]);
const FLAG_OPTIONS = new Set(["--json", "--aide", "-h", "--help"]);

const HELP = `np, accès agent à notion_perso

Lecture
  np chercher <mots…>                  pages qui contiennent ces mots (chemin, id, extrait)
  np lister [chemin|id]                enfants d'une page, entrées d'une base ; racines sans argument
  np lire <chemin|id> [--vers fichier] page en Markdown (base : tableau ; entrée : front matter des valeurs)
  np vide-cerveau --vers <dossier>     copie datée du Vide-cerveau, sans rien y supprimer

Écriture (jamais de remplacement : on ajoute en bas)
  np creer <fichier.md|-> [--sous chemin|id] [--titre t]   nouvelle page (titre : --titre, sinon le premier « # », sinon le nom du fichier)
  np ajouter <chemin|id> <fichier.md|->                     ajoute le Markdown au bas de la page
  np renommer <chemin|id> <titre…>
  np deplacer <chemin|id> <destination|/>                   « / » : racine de l'arbre
  np icone <chemin|id> <emoji|aucune>
  np corbeille <chemin|id>
  np restaurer <id>                                         une page en corbeille n'a plus de chemin : son id
  np depublier <chemin|id>
  np journal [--nombre n]                                   dernières écritures des agents

Le front matter d'un fichier est ignoré. Conversions et éléments ignorés sont signalés sur stderr.

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
  return async function call(path, method = "GET", body = undefined) {
    const headers = { Authorization: `Bearer ${token}` };
    if (model) headers["X-Agent-Model"] = model;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${server}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      throw new Exit(1, `Serveur injoignable (${server}) : ${error.cause?.code ?? error.message}`);
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    let message = data.error || `Réponse ${response.status}`;
    if (Array.isArray(data.candidates)) {
      message += ", précisez le chemin ou donnez l'id :\n" + data.candidates.map((c) => `  ${c.path}  (${c.type}, ${c.id})`).join("\n");
    }
    throw new Exit(1, message);
  };
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

// Fichier ou entrée standard (« - »).
function readSource(source) {
  if (!source) throw usage("Fichier Markdown attendu (ou « - » pour l'entrée standard)");
  if (source === "-") return { text: readFileSync(0, "utf8"), name: null };
  const file = resolve(source);
  if (!existsSync(file) || !statSync(file).isFile()) throw usage(`${file} n'est pas un fichier.`);
  return { text: readFileSync(file, "utf8"), name: basename(file).replace(/\.md$/i, "") };
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
    if (!target) throw usage("np lire <chemin|id> [--vers fichier]");
    const id = await resolveId(call, target);
    const page = await call(`/api/agent/pages/${encodeURIComponent(id)}?format=md`);
    if (page.trashed) process.stderr.write(`Attention : « ${page.path} » est en corbeille.\n`);
    if (options.json) return print(JSON.stringify(page, null, 2));
    if (!options.vers) return print(page.markdown);
    const file = resolve(options.vers);
    if (existsSync(file)) throw usage(`${file} existe déjà : np n'écrase aucun fichier.`);
    writeFileSync(file, page.markdown);
    print(`${page.path} écrit dans ${file}`);
  },

  async creer(call, args, options) {
    const source = readSource(args[0]);
    const { title, rest } = takeTitle(stripFrontMatter(source.text));
    const parentId = options.sous ? await resolveId(call, options.sous) : null;
    const name = options.titre ?? title ?? (source.name ? source.name.replace(/_/g, " ") : "");
    const result = await call("/api/agent/pages", "POST", { parentId, title: name, markdown: rest });
    report(result);
    if (options.json) return print(JSON.stringify(result, null, 2));
    print(`Page créée : « ${name || "Sans titre"} » (${result.id}), ${result.blocks} bloc(s).`);
  },

  async ajouter(call, args, options) {
    if (args.length < 2) throw usage("np ajouter <chemin|id> <fichier.md|->");
    const id = await resolveId(call, args.slice(0, -1).join(" "));
    const markdown = stripFrontMatter(readSource(args.at(-1)).text);
    const result = await call(`/api/agent/pages/${encodeURIComponent(id)}/append`, "POST", { markdown });
    report(result);
    if (options.json) return print(JSON.stringify(result, null, 2));
    print(`${result.blocks} bloc(s) ajouté(s) au bas de ${id}.`);
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
    if (!data.entries.length) return print("Journal vide.");
    print(
      data.entries
        .map((e) => `${new Date(e.at).toLocaleString("fr-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" })}  ${e.action}  « ${e.pageTitle || "Sans titre"} »  (${e.model || "modèle non déclaré"}, ${e.tokenName || "jeton supprimé"})`)
        .join("\n"),
    );
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

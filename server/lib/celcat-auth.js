import { CookieJar } from "tough-cookie";
import fetchCookieBuilder from "fetch-cookie";
import * as cheerio from "cheerio";
const XML_URL = process.env.CELCAT_XML_URL ??
    "https://celcat-auth.univ-reims.fr/997/groupes/t1739184.xml";
// Plafond des corps lus (après décompression) : HTML CAS et flux XML.
const MAX_BODY_BYTES = Number(process.env.CELCAT_MAX_BYTES || 5 * 1024 * 1024);
const MAX_REDIRECTS = 10;
const TIMEOUT_MS = 30000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/**
 * Hôtes autorisés : celui du flux XML + CAS_ALLOWED_HOSTS (hôte(s) exact(s)
 * du CAS universitaire, séparés par des virgules). Toute redirection ou
 * soumission d’identifiants vers un autre hôte est refusée.
 */
export function allowedHosts() {
    const hosts = new Set([new URL(XML_URL).host.toLowerCase()]);
    for (const h of (process.env.CAS_ALLOWED_HOSTS || "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
    return hosts;
}
export class CelcatAuthError extends Error {
}
export class UpstreamPolicyError extends Error {
}
/** HTTPS obligatoire, sauf boucle locale (tests / développement). */
function assertAllowedUrl(url) {
    const u = new URL(url);
    const secure = u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname.toLowerCase()));
    if (!secure || !allowedHosts().has(u.host.toLowerCase()) || u.username || u.password) {
        throw new UpstreamPolicyError("Destination amont non autorisée.");
    }
    return u;
}
async function readLimitedText(response) {
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BODY_BYTES) { await response.body?.cancel(); throw new UpstreamPolicyError("Réponse amont trop volumineuse."); }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new UpstreamPolicyError("Réponse amont trop volumineuse."); }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}
/**
 * Suit les redirections manuellement en validant chaque saut. Une requête
 * POST (identifiants) n’est jamais renvoyée telle quelle : 307/308 refusés,
 * 301/302/303 transformés en GET sans corps.
 */
async function safeFetch(fetchWithCookies, url, init = {}) {
    let current = assertAllowedUrl(url).href;
    let options = { ...init };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetchWithCookies(current, { ...options, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
            const text = await readLimitedText(response);
            return { response, url: current, text };
        }
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new UpstreamPolicyError("Redirection amont invalide.");
        if ((response.status === 307 || response.status === 308) && options.method && options.method !== "GET") {
            throw new UpstreamPolicyError("Redirection conservant les identifiants refusée.");
        }
        current = assertAllowedUrl(new URL(location, current)).href;
        options = { headers: {} };
    }
    throw new UpstreamPolicyError("Trop de redirections amont.");
}
/**
 * Se connecte au CAS de l'université avec les identifiants fournis, puis
 * récupère le flux XML de l'emploi du temps.
 *
 * Le mot de passe n'est utilisé qu'ici, en mémoire, le temps de cette seule
 * requête. Il n'est jamais écrit dans un log, un fichier, ou une base de
 * données. Seul le "jar" de cookies de session résultant est renvoyé, pour
 * être stocké (chiffré) côté client — voir lib/session.js.
 */
export async function loginAndFetchSchedule(username, password) {
    const jar = new CookieJar();
    const fetchWithCookies = fetchCookieBuilder(fetch, jar);
    // 1. On demande le XML : sans session, le CAS nous redirige vers son
    // formulaire de login (redirections validées une à une).
    const loginPage = await safeFetch(fetchWithCookies, XML_URL);
    const loginPageUrl = new URL(loginPage.url);
    if (!loginPageUrl.pathname.includes("/cas/login")) {
        // Cas de figure imprévu : pas de redirection vers le CAS. On considère
        // que le flux est peut-être déjà public, on renvoie tel quel.
        if (!loginPage.response.ok || !looksLikeCelcatXml(loginPage.text)) throw new CelcatAuthError("Le service CELCAT ne renvoie pas d’emploi du temps.");
        return { xml: loginPage.text, serializedJar: JSON.stringify(jar.toJSON()) };
    }
    // 2. On extrait les champs cachés du formulaire CAS (ex: "execution",
    // un jeton anti-rejeu unique à chaque tentative).
    const $ = cheerio.load(loginPage.text);
    const hiddenFields = {};
    $("form#fm1 input[type=hidden], form input[type=hidden]").each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value") ?? "";
        if (name)
            hiddenFields[name] = value;
    });
    if (!hiddenFields.execution) {
        throw new CelcatAuthError("Impossible de trouver le formulaire de connexion CAS (la page a peut-être changé de structure).");
    }
    // 3. On soumet le formulaire de connexion, uniquement à l’URL CAS validée
    // (hôte autorisé, HTTPS, chemin /cas/login).
    const form = new URLSearchParams({
        ...hiddenFields,
        username,
        password,
        _eventId: "submit",
    });
    const auth = await safeFetch(fetchWithCookies, assertAllowedUrl(loginPageUrl.href).href, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
    });
    // 4. Si on est revenu sur une page de login, les identifiants sont faux.
    if (new URL(auth.url).pathname.includes("/cas/login")) {
        throw new CelcatAuthError("Identifiant ou mot de passe incorrect.");
    }
    // 5. On doit maintenant être sur le XML. Par sécurité, si on n'y est pas,
    // on tente un GET explicite (certaines configs CAS demandent un aller-
    // retour supplémentaire avant de livrer le service demandé).
    let xml = auth.text;
    if (!looksLikeCelcatXml(xml)) {
        xml = (await safeFetch(fetchWithCookies, XML_URL)).text;
    }
    if (!looksLikeCelcatXml(xml)) {
        throw new CelcatAuthError("La connexion CAS a réussi mais le flux XML attendu n'a pas été trouvé. La structure du site a peut-être changé.");
    }
    return { xml, serializedJar: JSON.stringify(jar.toJSON()) };
}
/**
 * Réutilise une session déjà établie (cookie chiffré) pour récupérer le XML
 * sans redemander le mot de passe. Renvoie `null` si la session a expiré
 * (le front doit alors réafficher le formulaire de connexion).
 */
export async function fetchScheduleWithExistingSession(serializedJar) {
    const jar = CookieJar.fromJSON(serializedJar);
    const fetchWithCookies = fetchCookieBuilder(fetch, jar);
    const { response, text } = await safeFetch(fetchWithCookies, XML_URL);
    if (!response.ok) throw new Error('Service CELCAT indisponible');
    return looksLikeCelcatXml(text) ? text : null;
}
function looksLikeCelcatXml(text) {
    return /<(timetable|agenda|calendar|events)(?:\s|>)/i.test(text) && !/<html(?:\s|>)/i.test(text);
}

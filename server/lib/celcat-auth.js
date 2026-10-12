import { CookieJar } from "tough-cookie";
import fetchCookieBuilder from "fetch-cookie";
import * as cheerio from "cheerio";
const XML_URL = process.env.CELCAT_XML_URL ??
    "https://celcat-auth.univ-reims.fr/997/groupes/t1739184.xml";
export class CelcatAuthError extends Error {
}
const MAX_REDIRECTS = 3;
/**
 * Destination amont autorisée : l'origine exacte de CELCAT_XML_URL, ou une
 * URL HTTPS (port par défaut) dans le domaine parent de son hôte
 * (celcat-auth.univ-reims.fr -> univ-reims.fr et ses sous-domaines).
 */
function assertAllowedUrl(url) {
    const u = new URL(url);
    const xml = new URL(XML_URL);
    if (u.username || u.password) throw new Error("Destination amont non autorisée.");
    if (u.origin === xml.origin) return u;
    const labels = xml.hostname.toLowerCase().split(".");
    const parent = /^[\d.]+$|^\[/.test(xml.hostname) || labels.length < 3 ? null : labels.slice(1).join(".");
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.port !== "" || !parent || (h !== parent && !h.endsWith("." + parent))) {
        throw new Error("Redirection amont non autorisée.");
    }
    return u;
}
/**
 * Suit au plus MAX_REDIRECTS redirections en validant chaque saut. Après un
 * POST (identifiants), 307/308 sont refusés ; 301/302/303 deviennent un GET
 * sans corps.
 */
async function safeFetch(fetchWithCookies, url, init = {}) {
    let current = assertAllowedUrl(url).href;
    let options = init;
    for (let hop = 0; ; hop++) {
        const response = await fetchWithCookies(current, { ...options, redirect: "manual", signal: AbortSignal.timeout(30000) });
        if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current };
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) throw new Error("Redirection amont invalide.");
        if ((response.status === 307 || response.status === 308) && options.method && options.method !== "GET") {
            throw new Error("Redirection conservant les identifiants refusée.");
        }
        current = assertAllowedUrl(new URL(location, current)).href;
        options = {};
    }
}
/**
 * Se connecte au CAS de l'université avec les identifiants fournis, puis
 * récupère le flux XML de l'emploi du temps.
 *
 * Le mot de passe n'est utilisé qu'ici, en mémoire, le temps de cette seule
 * requête. Il n'est jamais écrit dans un log, un fichier, ou une base de
 * données. Seul le "jar" de cookies de session résultant est renvoyé, pour
 * être stocké (chiffré) côté client — voir lib/session.ts.
 */
export async function loginAndFetchSchedule(username, password) {
    const jar = new CookieJar();
    const fetchWithCookies = fetchCookieBuilder(fetch, jar);
    // 1. On demande le XML : sans session, le CAS nous redirige vers son
    // formulaire de login (redirections suivies et validées une à une).
    const { response: loginPageResponse, url: loginPageUrl } = await safeFetch(fetchWithCookies, XML_URL);
    const loginPageHtml = await loginPageResponse.text();
    if (!new URL(loginPageUrl).pathname.includes("/cas/login")) {
        // Cas de figure imprévu : pas de redirection vers le CAS. On considère
        // que le flux est peut-être déjà public, on renvoie tel quel.
        if (!loginPageResponse.ok || !looksLikeCelcatXml(loginPageHtml)) throw new CelcatAuthError("Le service CELCAT ne renvoie pas d’emploi du temps.");
        return { xml: loginPageHtml, serializedJar: JSON.stringify(jar.toJSON()) };
    }
    // 2. On extrait les champs cachés du formulaire CAS (ex: "execution",
    // un jeton anti-rejeu unique à chaque tentative).
    const $ = cheerio.load(loginPageHtml);
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
    // 3. On soumet le formulaire de connexion, uniquement à l'URL CAS validée.
    const form = new URLSearchParams({
        ...hiddenFields,
        username,
        password,
        _eventId: "submit",
    });
    const { response: authResponse, url: authUrl } = await safeFetch(fetchWithCookies, loginPageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
    });
    const authResultHtml = await authResponse.text();
    // 4. Si on est revenu sur une page de login, les identifiants sont faux.
    if (new URL(authUrl).pathname.includes("/cas/login")) {
        throw new CelcatAuthError("Identifiant ou mot de passe incorrect.");
    }
    // 5. On doit maintenant être sur le XML. Par sécurité, si on n'y est pas,
    // on tente un GET explicite (certaines configs CAS demandent un aller-
    // retour supplémentaire avant de livrer le service demandé).
    let xml = authResultHtml;
    if (!looksLikeCelcatXml(xml)) {
        xml = await (await safeFetch(fetchWithCookies, XML_URL)).response.text();
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
    const { response } = await safeFetch(fetchWithCookies, XML_URL);
    if (!response.ok) throw new Error('Service CELCAT indisponible');
    const body = await response.text();
    return looksLikeCelcatXml(body) ? body : null;
}
function looksLikeCelcatXml(text) {
    return /<(timetable|agenda|calendar|events)(?:\s|>)/i.test(text) && !/<html(?:\s|>)/i.test(text);
}

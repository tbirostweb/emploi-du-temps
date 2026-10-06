import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash, randomUUID } from "crypto";
export const SESSION_COOKIE_NAME = "edt_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 6; // 6h, à ajuster selon la durée réelle de session CAS observée
const MAX_ACTIVE_SESSIONS = Number(process.env.SESSION_MAX_ACTIVE || 5000);
// Plafond de sessions simultanées par identifiant : la plus ancienne est évincée au-delà.
const MAX_SESSIONS_PER_USER = Number(process.env.SESSION_MAX_PER_USER || 10);
// Taille maximale du cookie chiffré (limite navigateur ~4 Ko).
export const MAX_TOKEN_LENGTH = 3800;
/**
 * Registre serveur des sessions actives (liste d’autorisation, jti -> expiration).
 * Un JWE n’est accepté que si son identifiant figure ici : la déconnexion
 * révoque immédiatement le jeton, même copié. Le registre est en mémoire :
 * un redémarrage invalide toutes les sessions (échec sûr, reconnexion
 * demandée) et une seule réplique est prévue (voir README).
 */
const activeSessions = new Map(); // jti -> { exp, user }
const userSessions = new Map(); // empreinte de l’identifiant -> jti (ordre de création)
function removeSession(jti) {
    const entry = activeSessions.get(jti);
    activeSessions.delete(jti);
    const list = entry?.user && userSessions.get(entry.user);
    if (!list) return;
    const i = list.indexOf(jti);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) userSessions.delete(entry.user);
}
function pruneSessions(now = Date.now()) {
    for (const [id, { exp }] of activeSessions) if (exp <= now) removeSession(id);
}
// Empreinte non réversible : l’identifiant en clair n’est pas conservé.
const userKey = username => username ? createHash("sha256").update(String(username).normalize("NFKC").trim().toLowerCase()).digest("base64url") : undefined;
function getKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret === "change-moi-avec-une-vraie-cle-secrete") {
        throw new Error("SESSION_SECRET n'est pas configuré. Défini une vraie valeur secrète dans .env.local.");
    }
    // A256GCM veut une clé de 32 octets : on dérive une clé fixe à partir du secret.
    return createHash("sha256").update(secret).digest();
}
/** Chiffre le jar de cookies CELCAT (jamais le mot de passe) dans un JWE et enregistre la session. */
export async function createSessionToken(serializedJar, { username, logoutUrl } = {}) {
    pruneSessions();
    const jti = randomUUID();
    const token = await new EncryptJWT({ jar: serializedJar, ...(logoutUrl ? { cas: logoutUrl } : {}) })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setJti(jti)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
        .encrypt(getKey());
    // Vérifié avant l’enregistrement : un jeton refusé ne laisse aucune entrée orpheline.
    if (token.length > MAX_TOKEN_LENGTH) throw new Error("Session trop volumineuse");
    const user = userKey(username);
    if (user) {
        const list = userSessions.get(user) ?? [];
        while (list.length >= MAX_SESSIONS_PER_USER) removeSession(list[0]);
        list.push(jti);
        userSessions.set(user, list);
    }
    while (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
        // Évince la session la plus ancienne plutôt que de croître sans borne.
        removeSession(activeSessions.keys().next().value);
    }
    activeSessions.set(jti, { exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000, user });
    return token;
}
async function decrypt(token) {
    if (!token)
        return null;
    try {
        // Seul le couple dir/A256GCM émis par createSessionToken est accepté (PBES2 & co refusés avant toute dérivation de clé).
        const { payload } = await jwtDecrypt(token, getKey(), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
        return payload;
    }
    catch {
        return null; // expiré, altéré, ou clé changée -> on redemande une connexion
    }
}
/** Déchiffre une session active : `{ jar, logoutUrl }`, ou `null` si absente, invalide, expirée ou révoquée. */
export async function readSession(token) {
    const payload = await decrypt(token);
    if (!payload?.jti) return null;
    const entry = activeSessions.get(payload.jti);
    if (!entry || entry.exp <= Date.now()) { removeSession(payload.jti); return null; }
    if (payload.jar == null) return null;
    return { jar: payload.jar, logoutUrl: typeof payload.cas === "string" ? payload.cas : undefined };
}
/** Déchiffre le cookie de session. Renvoie `null` si absent, invalide, expiré ou révoqué. */
export async function readSessionToken(token) {
    return (await readSession(token))?.jar ?? null;
}
/** Révoque la session portée par ce jeton (déconnexion ou session CAS expirée). */
export async function revokeSessionToken(token) {
    const payload = await decrypt(token);
    if (payload?.jti) removeSession(payload.jti);
}
/** Réservé aux tests : nombre de sessions actives. */
export const activeSessionCount = () => activeSessions.size;
/** Réservé aux tests : déchiffrement brut d’un jeton (sans contrôle du registre). */
export const decryptSessionToken = decrypt;

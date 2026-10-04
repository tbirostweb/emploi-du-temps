import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash, randomUUID } from "crypto";
export const SESSION_COOKIE_NAME = "edt_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 6; // 6h, à ajuster selon la durée réelle de session CAS observée
const MAX_ACTIVE_SESSIONS = Number(process.env.SESSION_MAX_ACTIVE || 5000);
/**
 * Registre serveur des sessions actives (liste d’autorisation, jti -> expiration).
 * Un JWE n’est accepté que si son identifiant figure ici : la déconnexion
 * révoque immédiatement le jeton, même copié. Le registre est en mémoire :
 * un redémarrage invalide toutes les sessions (échec sûr, reconnexion
 * demandée) et une seule réplique est prévue (voir README).
 */
const activeSessions = new Map();
function pruneSessions(now = Date.now()) {
    for (const [id, exp] of activeSessions) if (exp <= now) activeSessions.delete(id);
}
function getKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret === "change-moi-avec-une-vraie-cle-secrete") {
        throw new Error("SESSION_SECRET n'est pas configuré. Défini une vraie valeur secrète dans .env.local.");
    }
    // A256GCM veut une clé de 32 octets : on dérive une clé fixe à partir du secret.
    return createHash("sha256").update(secret).digest();
}
/** Chiffre le jar de cookies CELCAT (jamais le mot de passe) dans un JWE et enregistre la session. */
export async function createSessionToken(serializedJar) {
    pruneSessions();
    if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
        // Évince la session la plus ancienne plutôt que de croître sans borne.
        activeSessions.delete(activeSessions.keys().next().value);
    }
    const jti = randomUUID();
    const token = await new EncryptJWT({ jar: serializedJar })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setJti(jti)
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
        .encrypt(getKey());
    activeSessions.set(jti, Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    return token;
}
async function decrypt(token) {
    if (!token)
        return null;
    try {
        const { payload } = await jwtDecrypt(token, getKey());
        return payload;
    }
    catch {
        return null; // expiré, altéré, ou clé changée -> on redemande une connexion
    }
}
/** Déchiffre le cookie de session. Renvoie `null` si absent, invalide, expiré ou révoqué. */
export async function readSessionToken(token) {
    const payload = await decrypt(token);
    if (!payload?.jti) return null;
    const exp = activeSessions.get(payload.jti);
    if (!exp || exp <= Date.now()) { activeSessions.delete(payload.jti); return null; }
    return payload.jar ?? null;
}
/** Révoque la session portée par ce jeton (déconnexion ou session CAS expirée). */
export async function revokeSessionToken(token) {
    const payload = await decrypt(token);
    if (payload?.jti) activeSessions.delete(payload.jti);
}

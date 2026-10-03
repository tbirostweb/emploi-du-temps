import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "crypto";
export const SESSION_COOKIE_NAME = "edt_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 6; // 6h, à ajuster selon la durée réelle de session CAS observée
function getKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret === "change-moi-avec-une-vraie-cle-secrete") {
        throw new Error("SESSION_SECRET n'est pas configuré. Défini une vraie valeur secrète dans .env.local.");
    }
    // A256GCM veut une clé de 32 octets : on dérive une clé fixe à partir du secret.
    return createHash("sha256").update(secret).digest();
}
/** Chiffre le jar de cookies CELCAT (jamais le mot de passe) dans un JWE. */
export async function createSessionToken(serializedJar) {
    return new EncryptJWT({ jar: serializedJar })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
        .encrypt(getKey());
}
/** Déchiffre le cookie de session. Renvoie `null` si absent, invalide ou expiré. */
export async function readSessionToken(token) {
    if (!token)
        return null;
    try {
        const { payload } = await jwtDecrypt(token, getKey());
        return payload.jar ?? null;
    }
    catch {
        return null; // expiré, altéré, ou clé changée -> on redemande une connexion
    }
}
export const sessionCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
};

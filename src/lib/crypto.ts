import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * At-rest encryption for OAuth tokens (ms_tokens, webex_tokens).
 *
 * AES-256-GCM with a key derived from TOKEN_ENCRYPTION_KEY. Ciphertext is
 * stored as "enc:v1:<iv>:<tag>:<data>" (base64url parts) so legacy plaintext
 * rows are told apart by the prefix and keep working until they are next
 * rewritten (the refresh path re-encrypts them).
 *
 * Without TOKEN_ENCRYPTION_KEY nothing changes: values are stored as before
 * and a single warning is logged at first use, so an existing server does not
 * break on upgrade. Set the key, then reconnect or let tokens refresh.
 */

const PREFIX = "enc:v1:";

let cachedKey: Buffer | null | undefined;
let warned = false;

function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) {
    cachedKey = null;
    return null;
  }
  // A 64-char hex string (openssl rand -hex 32) is used as-is; anything else
  // is hashed down to 32 bytes so any reasonably long passphrase works.
  cachedKey = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : createHash("sha256").update(raw).digest();
  return cachedKey;
}

export function tokenEncryptionEnabled(): boolean {
  return key() !== null;
}

/** Encrypt for storage. Returns the input unchanged when no key is configured. */
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) {
    if (!warned) {
      warned = true;
      console.warn(
        "TOKEN_ENCRYPTION_KEY is not set: OAuth tokens are stored unencrypted. Set it (openssl rand -hex 32) to encrypt them at rest."
      );
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
}

/**
 * Decrypt a stored value. Legacy plaintext (no prefix) is returned as-is.
 * An encrypted value with no key, or the wrong key, throws: better a loud
 * failure than silently using ciphertext as a bearer token.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) {
    throw new Error("Encrypted token found but TOKEN_ENCRYPTION_KEY is not set");
  }
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when the stored value still carries a legacy plaintext token. */
export function isLegacyPlaintext(stored: string): boolean {
  return !stored.startsWith(PREFIX);
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derive a 32-byte key from the env secret (SHA-256).
 * Never send this key to the client; encryption/decryption happens server-side only.
 */
function getKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt plaintext for storage. Returns base64 ciphertext and iv.
 * Standard practice: AES-256-GCM with random IV per message.
 */
export function encryptChatMessage(plaintext: string, secret: string): { ciphertext: string; iv: string } {
  const key = getKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, tag]);
  return {
    ciphertext: combined.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt a stored message. Throws if tampered or wrong key.
 */
export function decryptChatMessage(ciphertext: string, iv: string, secret: string): string {
  const key = getKey(secret);
  const combined = Buffer.from(ciphertext, "base64");
  const tag = combined.subarray(combined.length - TAG_LENGTH);
  const encrypted = combined.subarray(0, combined.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"), { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

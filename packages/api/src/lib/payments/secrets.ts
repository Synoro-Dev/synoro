import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@synoro/config";

const VERSION = "v1";

/** False when PAYMENTS_SECRET_KEY is unset: providers can't be connected. */
export function secretsAvailable() {
  return !!env.PAYMENTS_SECRET_KEY;
}

function key() {
  if (!env.PAYMENTS_SECRET_KEY) {
    throw new Error("PAYMENTS_SECRET_KEY is not set");
  }
  // Any long string works as the env value; hash it to a 256-bit key.
  return createHash("sha256").update(env.PAYMENTS_SECRET_KEY).digest();
}

/** AES-256-GCM: `v1:<iv>:<tag>:<ciphertext>`, base64url parts. */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    ...[iv, cipher.getAuthTag(), data].map((part) =>
      part.toString("base64url"),
    ),
  ].join(":");
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("Unknown payment secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

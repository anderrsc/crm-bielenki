import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY ?? "";
  const hex = k.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 64) throw new Error("ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(text: string): string {
  if (!text) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:" + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  if (!encoded) return encoded;
  if (!encoded.startsWith("enc:")) return encoded; // not encrypted, return as-is
  try {
    const buf = Buffer.from(encoded.slice(4), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc).toString("utf8") + decipher.final("utf8");
  } catch {
    return "";
  }
}

export function maskSecret(encoded: string): string {
  if (!encoded) return "";
  const raw = encoded.startsWith("enc:") ? decryptSecret(encoded) : encoded;
  if (!raw || raw.length <= 8) return "***";
  return raw.slice(0, 4) + "***" + raw.slice(-4);
}

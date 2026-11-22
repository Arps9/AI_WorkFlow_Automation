import crypto from 'crypto';
import { env } from '../config/env.config';

// AES-256-GCM encryption for third-party credentials stored in MongoDB.
const KEY = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  if (!payload) return '';
  if (!payload.startsWith('v1:')) return payload; // legacy plaintext value
  const [, ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJSON(obj: Record<string, any>): string {
  return encrypt(JSON.stringify(obj));
}

export function decryptJSON<T = Record<string, any>>(payload?: string): T | null {
  if (!payload) return null;
  try {
    return JSON.parse(decrypt(payload)) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

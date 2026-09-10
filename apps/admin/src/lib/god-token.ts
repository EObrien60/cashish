import { createHash, timingSafeEqual } from 'node:crypto';

/** Dedicated machine credential; unset or short secrets always fail closed. */
export function validGodToken(header: string | undefined | null): boolean {
  const secret = process.env.SAAS_GOD_TOKEN;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

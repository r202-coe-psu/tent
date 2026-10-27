/**
 * Server-only short-lived signed URLs for kiosk banner images.
 *
 * Stateless HMAC so any Node worker can verify. The key is derived from the existing
 * server-only `EXTERNAL_API_SECRET` (no extra env var); a purpose label keeps these
 * signatures distinct from anything else signed with that secret. Missing secret throws;
 * callers map to 503.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const KIOSK_BANNER_URL_TTL_MS = 15 * 60_000;

const SIG_RE = /^[0-9a-f]{64}$/;
const EXP_RE = /^[0-9]+$/;
const KEY_PURPOSE = 'kiosk-banner-image-url:v1';

function secret(): Buffer {
	const value = env.EXTERNAL_API_SECRET;
	if (!value) throw new Error('EXTERNAL_API_SECRET is not configured');
	return createHmac('sha256', value).update(KEY_PURPOSE).digest();
}

function hmacHex(id: string, exp: string): string {
	return createHmac('sha256', secret()).update(`${id}.${exp}`).digest('hex');
}

/** `/api/v1/kiosk/banners/{id}/image?exp={unixSeconds}&sig={hex}` */
export function signBannerImageUrl(id: string, nowMs = Date.now()): string {
	const exp = String(Math.floor((nowMs + KIOSK_BANNER_URL_TTL_MS) / 1000));
	const sig = hmacHex(id, exp);
	return `/api/v1/kiosk/banners/${encodeURIComponent(id)}/image?exp=${exp}&sig=${sig}`;
}

export function verifyBannerImageSig(
	id: string,
	exp: string | null,
	sig: string | null,
	nowMs = Date.now()
): boolean {
	if (!exp || !sig) return false;
	if (!EXP_RE.test(exp)) return false;
	const expSec = Number(exp);
	if (!Number.isSafeInteger(expSec) || expSec <= 0) return false;
	if (expSec * 1000 <= nowMs) return false;
	if (!SIG_RE.test(sig)) return false;
	const expected = Buffer.from(hmacHex(id, exp), 'hex');
	const actual = Buffer.from(sig, 'hex');
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

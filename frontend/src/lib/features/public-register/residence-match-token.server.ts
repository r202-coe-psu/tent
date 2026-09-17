/**
 * Short-lived signed tokens for public residence-match join (draft-residence-join-on-create).
 * Client never receives raw household / unassigned ids — only HMAC tokens.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const TOKEN_TTL_SEC = 15 * 60;
const PREFIX = 'resjoin';

export type ResidenceMatchTokenPayload =
	| { kind: 'shelter'; shelterCode: string; householdId: string; exp: number }
	| { kind: 'unassigned'; registrationId: string; exp: number };

export type ResidenceMatchTokenInput =
	| { kind: 'shelter'; shelterCode: string; householdId: string; exp?: number }
	| { kind: 'unassigned'; registrationId: string; exp?: number };

function signingSecret(): string {
	return env.EXTERNAL_API_SECRET || 'dev-insecure-residence-match-signing-secret';
}

function encodePayload(payload: ResidenceMatchTokenPayload): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(raw: string): ResidenceMatchTokenPayload | null {
	try {
		const json = Buffer.from(raw, 'base64url').toString('utf8');
		const parsed = JSON.parse(json) as ResidenceMatchTokenPayload;
		if (!parsed || typeof parsed !== 'object' || typeof parsed.exp !== 'number') return null;
		if (parsed.kind === 'shelter') {
			if (!parsed.shelterCode?.trim() || !parsed.householdId?.trim()) return null;
			return parsed;
		}
		if (parsed.kind === 'unassigned') {
			if (!parsed.registrationId?.trim()) return null;
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

export function signResidenceMatchToken(payload: ResidenceMatchTokenInput): string {
	const exp = payload.exp ?? Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
	const full: ResidenceMatchTokenPayload =
		payload.kind === 'shelter'
			? {
					kind: 'shelter',
					shelterCode: payload.shelterCode,
					householdId: payload.householdId,
					exp
				}
			: {
					kind: 'unassigned',
					registrationId: payload.registrationId,
					exp
				};
	const body = encodePayload(full);
	const sig = createHmac('sha256', signingSecret()).update(`${PREFIX}:${body}`).digest('base64url');
	return `${body}.${sig}`;
}

export function verifyResidenceMatchToken(
	token: string | null | undefined
): ResidenceMatchTokenPayload | null {
	if (!token?.trim()) return null;
	const dot = token.indexOf('.');
	if (dot <= 0) return null;
	const body = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!sig) return null;

	const expected = createHmac('sha256', signingSecret())
		.update(`${PREFIX}:${body}`)
		.digest('base64url');
	try {
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	} catch {
		return null;
	}

	const payload = decodePayload(body);
	if (!payload) return null;
	if (payload.exp < Math.floor(Date.now() / 1000)) return null;
	return payload;
}

export const RESIDENCE_MATCH_TOKEN_TTL_SEC = TOKEN_TTL_SEC;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const m = vi.hoisted(() => ({
	readPendingLink: vi.fn(),
	clearPendingLinkCookie: vi.fn(),
	verifyCredentials: vi.fn(),
	resolveLoginName: vi.fn(async (s: string) => s),
	readUserDocForLink: vi.fn(),
	assessLinkEligibility: vi.fn(),
	linkGoogleMfa: vi.fn(),
	linkThaidMfa: vi.fn(),
	mintLoginSession: vi.fn(),
	ipCheck: vi.fn(() => true),
	nonceCheck: vi.fn(() => true),
	gate: vi.fn(async (): Promise<{ enforce: boolean; reason?: string }> => ({
		enforce: false,
		reason: 'disabled'
	})),
	verifyCaptcha: vi.fn()
}));

const { MockServiceError } = vi.hoisted(() => ({
	MockServiceError: class MockServiceError extends Error {
		constructor(
			readonly code: string,
			message: string
		) {
			super(message);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/couch-admin', () => ({
	ServiceError: MockServiceError,
	serviceError: vi.fn(
		(e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 })
	),
	verifyCredentials: m.verifyCredentials
}));
vi.mock('$lib/server/google-oauth', () => ({ mintLoginSession: m.mintLoginSession }));
vi.mock('$lib/server/pending-link', () => ({
	readPendingLink: m.readPendingLink,
	clearPendingLinkCookie: m.clearPendingLinkCookie,
	maskSubject: (s: string) => s
}));
vi.mock('$lib/server/security/captcha', () => ({ ReCaptchaProvider: class {} }));
vi.mock('$lib/server/security/recaptcha-gate', () => ({
	resolveRecaptchaGate: m.gate,
	verifyRecaptchaOrSkip: m.verifyCaptcha
}));
vi.mock('$lib/server/security/rate-limiter', () => ({
	linkAccountIpLimiter: { check: m.ipCheck },
	linkAccountNonceLimiter: { check: m.nonceCheck }
}));
vi.mock('$lib/server/user-service', () => ({
	assessLinkEligibility: m.assessLinkEligibility,
	linkGoogleMfa: m.linkGoogleMfa,
	linkThaidMfa: m.linkThaidMfa,
	readUserDocForLink: m.readUserDocForLink,
	resolveLoginName: m.resolveLoginName
}));

import { POST } from './+server';

const GOOGLE_LINK = { provider: 'google', sub: 'g-1', email: 'a@x', nonce: 'n1' };
const DOC = { name: 'staff01', salt: 'salt', roles: [], must_change_password: true };

function call(body: Record<string, unknown> = { login: 'staff01', password: 'pw' }) {
	const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as Cookies;
	const request = new Request('http://localhost/api/v1/auth/link-account', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({
		request,
		cookies,
		getClientAddress: () => '10.0.0.1'
	} as unknown as Parameters<typeof POST>[0]);
}

async function errorCode(res: Response): Promise<string | undefined> {
	return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

describe('POST /api/v1/auth/link-account (CR-141)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		m.readPendingLink.mockReturnValue(GOOGLE_LINK);
		m.verifyCredentials.mockResolvedValue(undefined);
		m.readUserDocForLink.mockResolvedValue(DOC);
		m.assessLinkEligibility.mockReturnValue('ok');
		m.linkGoogleMfa.mockResolvedValue(undefined);
		m.linkThaidMfa.mockResolvedValue(undefined);
		m.ipCheck.mockReturnValue(true);
		m.nonceCheck.mockReturnValue(true);
		m.gate.mockResolvedValue({ enforce: false, reason: 'disabled' });
	});

	it('401 LINK_EXPIRED without a pending link', async () => {
		m.readPendingLink.mockReturnValue(null);
		const res = await call();
		expect(res.status).toBe(401);
		expect(await errorCode(res)).toBe('LINK_EXPIRED');
		expect(m.verifyCredentials).not.toHaveBeenCalled();
	});

	it('429 + clears cookie when the nonce budget is spent', async () => {
		m.nonceCheck.mockReturnValue(false);
		const res = await call();
		expect(res.status).toBe(429);
		expect(m.clearPendingLinkCookie).toHaveBeenCalled();
		expect(m.verifyCredentials).not.toHaveBeenCalled();
	});

	it('401 LINK_REJECTED on a wrong password, before any eligibility read', async () => {
		m.verifyCredentials.mockRejectedValue(new MockServiceError('UNAUTHENTICATED', 'no'));
		const res = await call();
		expect(res.status).toBe(401);
		expect(await errorCode(res)).toBe('LINK_REJECTED');
		expect(m.readUserDocForLink).not.toHaveBeenCalled();
	});

	it('403 LINK_REJECTED for an account that is not new', async () => {
		m.assessLinkEligibility.mockReturnValue('not_new');
		const res = await call();
		expect(res.status).toBe(403);
		expect(await errorCode(res)).toBe('LINK_REJECTED');
		expect(m.linkGoogleMfa).not.toHaveBeenCalled();
		expect(m.mintLoginSession).not.toHaveBeenCalled();
	});

	it('409 when the subject is already linked elsewhere', async () => {
		m.linkGoogleMfa.mockRejectedValue(new MockServiceError('CONFLICT', 'taken'));
		const res = await call();
		expect(res.status).toBe(409);
		expect(m.mintLoginSession).not.toHaveBeenCalled();
		expect(m.clearPendingLinkCookie).toHaveBeenCalled();
	});

	it('links Google, mints a session and clears the pending cookie', async () => {
		const res = await call();
		expect(res.status).toBe(200);
		expect(m.linkGoogleMfa).toHaveBeenCalledWith('staff01', { subject: 'g-1', email: 'a@x' });
		expect(m.mintLoginSession).toHaveBeenCalledWith(expect.anything(), 'staff01', 'salt');
		expect(m.clearPendingLinkCookie).toHaveBeenCalled();
	});

	it('links ThaID with display fields', async () => {
		m.readPendingLink.mockReturnValue({
			provider: 'thaid',
			sub: 't-1',
			name: 'สมชาย',
			pid_masked: '1-xx',
			nonce: 'n2'
		});
		const res = await call();
		expect(res.status).toBe(200);
		expect(m.linkThaidMfa).toHaveBeenCalledWith('staff01', {
			subject: 't-1',
			name: 'สมชาย',
			pid_masked: '1-xx'
		});
	});

	it('verifies reCAPTCHA only when the gate enforces it', async () => {
		m.gate.mockResolvedValue({ enforce: true });
		m.verifyCaptcha.mockResolvedValue({ ok: false, error: 'CAPTCHA_FAILED', status: 403 });
		const res = await call({ login: 'staff01', password: 'pw', captcha_token: 't' });
		expect(res.status).toBe(403);
		expect(m.verifyCredentials).not.toHaveBeenCalled();
	});
});

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { serviceError, ServiceError, verifyCredentials } from '$lib/server/couch-admin';
import { mintLoginSession } from '$lib/server/google-oauth';
import {
	clearPendingLinkCookie,
	maskSubject,
	readPendingLink,
	type PendingLink
} from '$lib/server/pending-link';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { resolveRecaptchaGate, verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import { linkAccountIpLimiter, linkAccountNonceLimiter } from '$lib/server/security/rate-limiter';
import {
	assessLinkEligibility,
	linkGoogleMfa,
	linkThaidMfa,
	readUserDocForLink,
	resolveLoginName
} from '$lib/server/user-service';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);

/** One message for wrong password, unknown user and ineligible account (FR-16/17). */
const REJECTED = 'ไม่สามารถเชื่อมบัญชีนี้ได้ กรุณาตรวจสอบข้อมูลหรือติดต่อผู้ดูแลระบบ';

type LinkResult =
	| 'linked'
	| 'expired'
	| 'rate_limited'
	| 'captcha_failed'
	| 'bad_credentials'
	| 'not_eligible'
	| 'conflict';

function audit(link: PendingLink | null, result: LinkResult, user?: string, detail?: string) {
	console.warn('[auth-link]', {
		at: new Date().toISOString(),
		provider: link?.provider ?? null,
		sub: link ? maskSubject(link.sub) : null,
		user: user ?? null,
		result,
		...(detail ? { detail } : {})
	});
}

function reject(code: string, message: string, status: number): Response {
	return json({ error: { code, message } }, { status });
}

/**
 * POST { login, password, captcha_token? } — link the OAuth identity held in `pending_link`
 * to a fresh admin-provisioned account and sign in (CR-141 FR-14..22).
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const link = readPendingLink(cookies);
	try {
		if (!link) {
			audit(null, 'expired');
			return reject('LINK_EXPIRED', 'หมดเวลาการเชื่อมบัญชี กรุณาเข้าสู่ระบบใหม่อีกครั้ง', 401);
		}

		const ip = getClientAddress();
		if (!linkAccountIpLimiter.check(ip) || !linkAccountNonceLimiter.check(link.nonce)) {
			clearPendingLinkCookie(cookies);
			audit(link, 'rate_limited');
			return reject('RATE_LIMITED', 'ลองหลายครั้งเกินไป กรุณาเข้าสู่ระบบใหม่อีกครั้ง', 429);
		}

		const body = (await request.json().catch(() => ({}))) as {
			login?: unknown;
			password?: unknown;
			captcha_token?: unknown;
		};
		const login = typeof body.login === 'string' ? body.login.trim() : '';
		const password = typeof body.password === 'string' ? body.password : '';
		const token = typeof body.captcha_token === 'string' ? body.captcha_token.trim() : '';
		if (!login || !password) {
			return reject('VALIDATION', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 422);
		}

		// Same gate as the password form: only verify when the operator flag + keys say so.
		if ((await resolveRecaptchaGate()).enforce) {
			const captcha = await verifyRecaptchaOrSkip({
				token,
				ip,
				action: 'login',
				provider: captchaProvider
			});
			if (!captcha.ok) {
				audit(link, 'captcha_failed', undefined, captcha.error);
				return reject(
					captcha.error,
					'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่',
					captcha.status
				);
			}
		}

		const name = await resolveLoginName(login);
		try {
			await verifyCredentials(name, password);
		} catch (e) {
			if (e instanceof ServiceError && e.code === 'UNAUTHENTICATED') {
				audit(link, 'bad_credentials', name);
				return reject('LINK_REJECTED', REJECTED, 401);
			}
			throw e;
		}

		const doc = await readUserDocForLink(name);
		const eligibility = doc ? assessLinkEligibility(doc) : 'not_new';
		if (!doc || eligibility !== 'ok') {
			audit(link, 'not_eligible', name, eligibility);
			return reject('LINK_REJECTED', REJECTED, 403);
		}

		try {
			if (link.provider === 'google') {
				await linkGoogleMfa(doc.name, { subject: link.sub, email: link.email });
			} else {
				await linkThaidMfa(doc.name, {
					subject: link.sub,
					name: link.name,
					pid_masked: link.pid_masked
				});
			}
		} catch (e) {
			if (e instanceof ServiceError && e.code === 'CONFLICT') {
				clearPendingLinkCookie(cookies);
				audit(link, 'conflict', doc.name);
				return reject('CONFLICT', 'บัญชีนี้ถูกเชื่อมกับผู้ใช้อื่นแล้ว กรุณาติดต่อผู้ดูแลระบบ', 409);
			}
			throw e;
		}

		// `salt` is checked by assessLinkEligibility and unchanged by the link write.
		await mintLoginSession(cookies, doc.name, doc.salt as string);
		clearPendingLinkCookie(cookies);
		audit(link, 'linked', doc.name);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};

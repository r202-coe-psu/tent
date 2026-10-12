/**
 * Thai, user-facing messages for every way sign-in can fail. Shown inline under the
 * form (not as a toast) so the reason stays on screen until the user acts on it.
 */

export type LoginErrorView = {
	title: string;
	/** Optional bullet list of things to check — never reveals which one applied. */
	hints?: readonly string[];
};

export const RECAPTCHA_UNAVAILABLE = 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง';
export const CAPTCHA_FAILED = 'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่';

const WRONG_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
const NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
const SERVER_DOWN = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ในอีกสักครู่';
const LOGIN_FAILED = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
const LINK_FAILED = 'เชื่อมบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
const THAI_RE = /[\u0E00-\u0E7F]/;

/** Errors this feature throws itself already carry Thai copy — pass them through. */
const OWN_MESSAGES = new Set([RECAPTCHA_UNAVAILABLE, CAPTCHA_FAILED]);

/** Map a password-login failure (CouchDB `_session` via `couchFetch`) to Thai copy. */
export function loginErrorView(err: unknown): LoginErrorView {
	if (err instanceof TypeError) return { title: NETWORK }; // fetch() network failure
	const message = err instanceof Error ? err.message : '';
	if (OWN_MESSAGES.has(message)) return { title: message };
	if (/name or password is incorrect|unauthorized/i.test(message)) {
		return {
			title: WRONG_CREDENTIALS,
			hints: [
				'ตรวจสอบตัวพิมพ์เล็ก-ใหญ่ของชื่อผู้ใช้และรหัสผ่าน',
				'หากลืมรหัสผ่าน กด "ลืมรหัสผ่าน?"'
			]
		};
	}
	if (/\(5\d\d\)|service unavailable|bad gateway|timeout/i.test(message)) {
		return { title: SERVER_DOWN };
	}
	return { title: LOGIN_FAILED };
}

/** `?error=` codes the OAuth callbacks and the link page redirect back to `/login` with. */
const CALLBACK_ERRORS: Record<string, string> = {
	// CR-141 FR-26 — never point at the hidden password route from here.
	google_not_linked: 'บัญชีนี้ยังไม่ได้เชื่อมกับระบบ กรุณาติดต่อผู้ดูแลระบบ',
	thaid_not_linked: 'บัญชีนี้ยังไม่ได้เชื่อมกับระบบ กรุณาติดต่อผู้ดูแลระบบ',
	link_expired: 'หมดเวลาการเชื่อมบัญชี กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
	link_rate_limited: 'ลองเชื่อมบัญชีหลายครั้งเกินไป กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
	link_conflict: 'บัญชีนี้ถูกเชื่อมกับผู้ใช้อื่นแล้ว กรุณาติดต่อผู้ดูแลระบบ',
	thaid_login_failed: 'ไม่สามารถเข้าสู่ระบบด้วย ThaID ได้ กรุณาลองอีกครั้ง',
	thaid_disabled: 'ระบบ ThaiD Digital ID ถูกปิดใช้งานชั่วคราว',
	invalid_state: 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง',
	google_login_failed: 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองอีกครั้ง'
};

/** Thai copy for a `/login?error=` code (generic fallback for an unknown code). */
export function callbackErrorMessage(code: string): string {
	if (Object.hasOwn(CALLBACK_ERRORS, code)) return CALLBACK_ERRORS[code];
	if (code.startsWith('oauth_')) {
		return 'ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนภายนอกได้ กรุณาลองอีกครั้ง';
	}
	return 'ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง';
}

/** Link-account error codes that end the pending link → back to `/login?error=<value>`. */
export const LINK_TERMINAL_REDIRECTS: Readonly<Record<string, string>> = {
	LINK_EXPIRED: 'link_expired',
	RATE_LIMITED: 'link_rate_limited',
	CONFLICT: 'link_conflict'
};

/**
 * Every LINK_REJECTED reason, listed together. The server sends one message for all of
 * them (CR-141 FR-16/17 — no user enumeration), so the hints must stay identical.
 */
const LINK_REJECTED_HINTS = [
	'ชื่อผู้ใช้ (หรือเบอร์โทรศัพท์) และรหัสผ่านชั่วคราวถูกต้องตามที่ได้รับจากผู้ดูแลระบบ',
	'ผู้ดูแลระบบสร้างบัญชีให้คุณแล้ว',
	'บัญชียังไม่เคยเปลี่ยนรหัสผ่านชั่วคราว หากเปลี่ยนแล้ว ให้ผู้ดูแลระบบรีเซ็ตรหัสผ่านให้ใหม่',
	'บัญชียังไม่ได้เชื่อมกับ Google หรือ ThaiD บัญชีอื่น'
] as const;

/** Map a link-account failure (server envelope `{ code, message }`) to an inline view. */
export function linkErrorView(code: string, message: string): LoginErrorView {
	if (code === 'LINK_REJECTED') return { title: message, hints: LINK_REJECTED_HINTS };
	if (code === 'INTERNAL') return { title: SERVER_DOWN };
	// Server envelopes for this route are Thai; anything else (e.g. a proxy error) is not.
	return { title: THAI_RE.test(message) ? message : LINK_FAILED };
}

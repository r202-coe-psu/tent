import { describe, expect, it } from 'vitest';
import {
	CAPTCHA_FAILED,
	callbackErrorMessage,
	LINK_TERMINAL_REDIRECTS,
	linkErrorView,
	loginErrorView,
	RECAPTCHA_UNAVAILABLE
} from './errors';

const THAI = /[฀-๿]/;

describe('loginErrorView', () => {
	it('maps the CouchDB 401 reason to Thai wrong-credentials copy with hints', () => {
		const view = loginErrorView(new Error('Name or password is incorrect.'));
		expect(view.title).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
		expect(view.hints?.length).toBeGreaterThan(0);
	});

	it('maps a fetch network failure (TypeError) to a connection message', () => {
		expect(loginErrorView(new TypeError('Failed to fetch')).title).toContain(
			'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'
		);
	});

	it('maps a proxy/5xx failure to a temporary-outage message', () => {
		expect(loginErrorView(new Error('CouchDB request failed (502)')).title).toContain(
			'ขัดข้องชั่วคราว'
		);
	});

	it('passes the feature’s own Thai captcha messages through', () => {
		expect(loginErrorView(new Error(RECAPTCHA_UNAVAILABLE)).title).toBe(RECAPTCHA_UNAVAILABLE);
		expect(loginErrorView(new Error(CAPTCHA_FAILED)).title).toBe(CAPTCHA_FAILED);
	});

	it('never leaks an unknown English message', () => {
		const view = loginErrorView(new Error('something exploded'));
		expect(view.title).toMatch(THAI);
		expect(view.title).not.toContain('exploded');
	});
});

describe('callbackErrorMessage', () => {
	it.each([
		'google_not_linked',
		'thaid_not_linked',
		'link_expired',
		'thaid_login_failed',
		'thaid_disabled',
		'invalid_state',
		'google_login_failed',
		'oauth_access_denied',
		'unknown_code',
		...Object.values(LINK_TERMINAL_REDIRECTS)
	])('returns Thai copy for %s', (code) => {
		expect(callbackErrorMessage(code)).toMatch(THAI);
	});

	it('does not point at the hidden password route (CR-141 FR-26)', () => {
		expect(callbackErrorMessage('google_not_linked')).not.toContain('admin-login');
	});

	it('ignores prototype keys', () => {
		expect(callbackErrorMessage('toString')).toMatch(THAI);
	});
});

describe('linkErrorView', () => {
	const REJECTED = 'ไม่สามารถเชื่อมบัญชีนี้ได้ กรุณาตรวจสอบข้อมูลหรือติดต่อผู้ดูแลระบบ';

	it('adds the same reason checklist to every LINK_REJECTED (FR-16/17)', () => {
		const view = linkErrorView('LINK_REJECTED', REJECTED);
		expect(view.title).toBe(REJECTED);
		expect(view.hints?.length).toBeGreaterThanOrEqual(3);
	});

	it('keeps the server Thai message for other codes', () => {
		expect(linkErrorView('VALIDATION', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')).toEqual({
			title: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'
		});
	});

	it('replaces English INTERNAL / non-Thai messages with Thai copy', () => {
		expect(linkErrorView('INTERNAL', 'Could not read user for link').title).toMatch(THAI);
		expect(linkErrorView('FORBIDDEN', 'Bad Gateway').title).toMatch(THAI);
	});
});

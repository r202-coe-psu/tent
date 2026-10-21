import { afterEach, describe, expect, it, vi } from 'vitest';
import { familySearch, PublicApiError, publicApiError } from './public-api';

const FALLBACK = 'เกิดข้อผิดพลาดในการค้นหา';

describe('publicApiError', () => {
	it('maps FastAPI errors[] VALIDATION body to validation', () => {
		const body = {
			errors: [{ error: { code: 'VALIDATION', message: 'Query is too short or invalid' } }]
		};
		const err = publicApiError(body, 422, FALLBACK);
		expect(err.kind).toBe('validation');
		expect(err.message).toBe(FALLBACK);
	});

	it('maps top-level BFF error.code', () => {
		expect(publicApiError({ error: { code: 'VALIDATION' } }, 400, FALLBACK).kind).toBe(
			'validation'
		);
		expect(publicApiError({ error: { code: 'SEARCH_UNAVAILABLE' } }, 503, FALLBACK).kind).toBe(
			'unavailable'
		);
	});

	it('maps RATE_LIMITED and 429', () => {
		const body = { errors: [{ error: { code: 'RATE_LIMITED', message: 'Too many' } }] };
		expect(publicApiError(body, 429, FALLBACK).kind).toBe('rateLimited');
		expect(publicApiError(null, 429, FALLBACK).kind).toBe('rateLimited');
	});

	it('maps 503 and 422 by status when the body has no code', () => {
		expect(publicApiError(null, 503, FALLBACK).kind).toBe('unavailable');
		expect(publicApiError({ errors: ['secret'] }, 422, FALLBACK).kind).toBe('validation');
	});

	it('never exposes raw backend text and falls back for unknown errors', () => {
		const err = publicApiError({ error: { message: 'Upstream exploded' } }, 500, FALLBACK);
		expect(err.kind).toBe('generic');
		expect(err.message).toBe(FALLBACK);
		expect(publicApiError({ error: 'UPSTREAM_DOWN' }, 500, FALLBACK).message).toBe(FALLBACK);
		expect(publicApiError({ errors: ['Invalid secret'] }, 401, FALLBACK).message).toBe(FALLBACK);
	});

	it('uses provided per-kind messages', () => {
		const err = publicApiError(null, 429, FALLBACK, { rateLimited: 'ช้าหน่อย' });
		expect(err.message).toBe('ช้าหน่อย');
	});
});

describe('familySearch', () => {
	afterEach(() => vi.unstubAllGlobals());

	function stubFetch(impl: () => Promise<unknown>) {
		vi.stubGlobal('fetch', vi.fn(impl));
	}

	it('turns a network failure into an unavailable PublicApiError', async () => {
		stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		const err = await familySearch('สมชาย').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PublicApiError);
		expect((err as PublicApiError).kind).toBe('unavailable');
		expect((err as PublicApiError).message).toBe('ระบบค้นหาไม่พร้อมใช้งานชั่วคราว');
	});

	it('maps a 429 response to Thai rate-limit copy', async () => {
		stubFetch(() =>
			Promise.resolve({
				ok: false,
				status: 429,
				json: () =>
					Promise.resolve({ errors: [{ error: { code: 'RATE_LIMITED', message: 'Too many' } }] })
			})
		);
		await expect(familySearch('สมชาย')).rejects.toMatchObject({
			kind: 'rateLimited',
			message: 'ค้นหาบ่อยเกินไป ลองใหม่ภายหลัง'
		});
	});

	it('returns data on success', async () => {
		stubFetch(() =>
			Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })
		);
		await expect(familySearch('สมชาย')).resolves.toEqual({ results: [] });
	});
});

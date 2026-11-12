import { afterEach, describe, expect, it, vi } from 'vitest';
import { familySearch, getPublicShelter, PublicApiError, publicApiError } from './public-api';

import type { SearchConsent } from '../domain/search-consent';

const CONSENT: SearchConsent = {
	searcher: { first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678' },
	purpose: 'find_family',
	consent_accepted: true
};
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
		const err = await familySearch('สมชาย', CONSENT).catch((e: unknown) => e);
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
		await expect(familySearch('สมชาย', CONSENT)).rejects.toMatchObject({
			kind: 'rateLimited',
			message: 'ค้นหาบ่อยเกินไป ลองใหม่ภายหลัง'
		});
	});

	it('sends the searcher, purpose and consent next to the query (CR-231 FR-6)', async () => {
		const fetchFn = vi.fn(() =>
			Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })
		);
		vi.stubGlobal('fetch', fetchFn);
		await familySearch('สมชาย', CONSENT);
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/public/v1/occupants');
		expect(JSON.parse(init.body as string)).toEqual({ search: 'สมชาย', ...CONSENT });
	});

	it('returns data on success', async () => {
		stubFetch(() =>
			Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })
		);
		await expect(familySearch('สมชาย', CONSENT)).resolves.toEqual({ results: [] });
	});
});

describe('getPublicShelter', () => {
	function fetchStub(response: unknown) {
		return vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch;
	}

	it('unwraps the shelter and encodes the code in the path', async () => {
		const shelter = { id: 'SH 001', name: 'ศูนย์ A', address: 'ที่อยู่', geo: { lat: 1, lng: 2 } };
		const fetchFn = fetchStub({ ok: true, status: 200, json: () => Promise.resolve({ shelter }) });
		await expect(getPublicShelter('SH 001', fetchFn)).resolves.toEqual(shelter);
		expect(fetchFn).toHaveBeenCalledWith('/api/public/v1/shelters/SH%20001');
	});

	it('throws PublicApiError on 404', async () => {
		const fetchFn = fetchStub({
			ok: false,
			status: 404,
			json: () => Promise.resolve({ error: 'Shelter not found' })
		});
		await expect(getPublicShelter('NOPE', fetchFn)).rejects.toBeInstanceOf(PublicApiError);
	});

	it('maps 503 to unavailable', async () => {
		const fetchFn = fetchStub({
			ok: false,
			status: 503,
			json: () => Promise.resolve({ error: 'Shelter not found' })
		});
		await expect(getPublicShelter('SH001', fetchFn)).rejects.toMatchObject({
			kind: 'unavailable'
		});
	});

	it('treats a 200 without a shelter as a failure', async () => {
		const fetchFn = fetchStub({ ok: true, status: 200, json: () => Promise.resolve({}) });
		await expect(getPublicShelter('SH001', fetchFn)).rejects.toBeInstanceOf(PublicApiError);
	});

	it('turns a network failure into unavailable', async () => {
		const fetchFn = vi.fn(() =>
			Promise.reject(new TypeError('Failed to fetch'))
		) as unknown as typeof fetch;
		await expect(getPublicShelter('SH001', fetchFn)).rejects.toMatchObject({ kind: 'unavailable' });
	});
});

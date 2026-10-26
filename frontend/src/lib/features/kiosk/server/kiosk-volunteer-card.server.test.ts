import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '$lib/db/hash';
import { adminFetch } from '$lib/server/couch-admin';
import { KioskLookupUnavailableError } from './kiosk-check-in.server';
import {
	KioskVolunteerCardNotFoundError,
	resolveKioskVolunteerCard
} from './kiosk-volunteer-card.server';

vi.mock('$lib/server/couch-admin', () => ({ adminFetch: vi.fn() }));

const mockAdminFetch = vi.mocked(adminFetch);

type Doc = Record<string, unknown> & { _id: string };
type Selector = Record<string, unknown>;

const TOKEN_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

let databases: Record<string, Doc[]> = {};
let calls: { path: string; method: string }[] = [];

/** Minimal Mango evaluator: implicit AND, equality, `$in`, `$or`. */
function matches(doc: Doc, selector: Selector): boolean {
	return Object.entries(selector).every(([key, condition]) => {
		if (key === '$or') return (condition as Selector[]).some((branch) => matches(doc, branch));
		const value = doc[key];
		if (typeof condition === 'object' && condition !== null && '$in' in condition) {
			return (condition as { $in: unknown[] }).$in.includes(value);
		}
		return value === condition;
	});
}

function volunteer(overrides: Record<string, unknown> = {}): Doc {
	return {
		_id: 'volunteer:01ARZ3NDEKTSV4RRFFQ69G5FAV',
		type: 'volunteer',
		volunteer_code: 'VOL-0001',
		first_name: 'Somchai',
		last_name: 'Wongsawat',
		phone: '0812345678',
		status: 'active',
		tracking_token_hash: TOKEN_HASH,
		...overrides
	};
}

beforeEach(() => {
	databases = {};
	calls = [];
	mockAdminFetch.mockReset();
	mockAdminFetch.mockImplementation(async (path, init) => {
		const method = init?.method ?? 'GET';
		calls.push({ path: String(path), method });
		const match = /^\/([^/]+)\/_find$/.exec(String(path));
		if (!match || method !== 'POST') throw new Error(`unexpected request ${method} ${path}`);
		const { selector } = JSON.parse(String(init?.body)) as { selector: Selector };
		return { docs: (databases[match[1]] ?? []).filter((doc) => matches(doc, selector)) } as never;
	});
});

describe('resolveKioskVolunteerCard', () => {
	it('returns the existing role-card QR for the one active volunteer with that phone in this shelter', async () => {
		databases.shelter_sh001 = [volunteer()];

		await expect(resolveKioskVolunteerCard('SH001', '0812345678')).resolves.toEqual({
			display_name: 'Somchai Wo****t',
			volunteer_code: 'VOL-0001',
			qr_payload: 'TKT-VOL-HASH-A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90'
		});
	});

	it('appends the nickname in parentheses when the volunteer has one', async () => {
		databases.shelter_sh001 = [volunteer({ nickname: 'Chai' })];

		const card = await resolveKioskVolunteerCard('SH001', '0812345678');

		expect(card.display_name).toBe('Somchai Wo****t (Chai)');
	});

	it.each([
		['the last name is missing', { last_name: undefined, nickname: 'Chai' }, 'Somchai (Chai)'],
		['the first name is missing', { first_name: undefined }, 'Wo****t'],
		['names carry stray spaces', { first_name: ' Somchai ', nickname: '  ' }, 'Somchai Wo****t']
	])('builds a clean display name when %s', async (_label, overrides, expected) => {
		databases.shelter_sh001 = [volunteer(overrides)];

		const card = await resolveKioskVolunteerCard('SH001', '0812345678');

		expect(card.display_name).toBe(expected);
	});

	it('matches a volunteer whose stored phone is the +66 variant', async () => {
		databases.shelter_sh001 = [volunteer({ phone: '+66812345678' })];

		const card = await resolveKioskVolunteerCard('SH001', '0812345678');

		expect(card.volunteer_code).toBe('VOL-0001');
	});

	it('matches a volunteer found only through phone_hash', async () => {
		databases.shelter_sh001 = [
			volunteer({ phone: '081 234 5678', phone_hash: await sha256Hex('0812345678') })
		];

		const card = await resolveKioskVolunteerCard('SH001', '0812345678');

		expect(card.volunteer_code).toBe('VOL-0001');
	});

	it('does not match a stale phone_hash whose phone field is now a different number', async () => {
		databases.shelter_sh001 = [
			volunteer({ phone: '0899999999', phone_hash: await sha256Hex('0812345678') })
		];

		await expect(resolveKioskVolunteerCard('SH001', '0812345678')).rejects.toBeInstanceOf(
			KioskVolunteerCardNotFoundError
		);
	});

	it.each([
		['there is no match', () => ({}), { phone: '0899999999' }],
		['the volunteer is only in a different shelter', () => ({ shelter_sh002: [volunteer()] }), {}],
		['the volunteer is inactive', () => ({}), { status: 'inactive' }],
		['the token hash is null', () => ({}), { tracking_token_hash: null }],
		['the token hash is missing', () => ({}), { tracking_token_hash: undefined }],
		['the token hash is not 64 hex chars', () => ({}), { tracking_token_hash: 'abc123' }],
		[
			'the volunteer only has a legacy plaintext tracking_token',
			() => ({}),
			{ tracking_token_hash: undefined, tracking_token: 'TKT-VOL-0123456789ABCDEF' }
		]
	])('throws not-found when %s', async (_label, otherShelters, overrides) => {
		const others = otherShelters();
		databases = {
			...others,
			shelter_sh001: 'shelter_sh002' in others ? [] : [volunteer(overrides)]
		};

		await expect(resolveKioskVolunteerCard('SH001', '0812345678')).rejects.toBeInstanceOf(
			KioskVolunteerCardNotFoundError
		);
	});

	it('throws not-found when two active volunteers share the phone', async () => {
		databases.shelter_sh001 = [
			volunteer(),
			volunteer({ _id: 'volunteer:01ARZ3NDEKTSV4RRFFQ69G5FAW', volunteer_code: 'VOL-0002' })
		];

		await expect(resolveKioskVolunteerCard('SH001', '0812345678')).rejects.toBeInstanceOf(
			KioskVolunteerCardNotFoundError
		);
	});

	it('only reads: every request is a POST to a _find path', async () => {
		databases.shelter_sh001 = [volunteer()];

		await resolveKioskVolunteerCard('SH001', '0812345678');

		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) {
			expect(call.method).toBe('POST');
			expect(call.path).toMatch(/\/_find$/);
		}
	});

	it('reports the lookup as unavailable when CouchDB is down', async () => {
		mockAdminFetch.mockRejectedValue(new Error('ECONNREFUSED'));

		await expect(resolveKioskVolunteerCard('SH001', '0812345678')).rejects.toBeInstanceOf(
			KioskLookupUnavailableError
		);
	});
});

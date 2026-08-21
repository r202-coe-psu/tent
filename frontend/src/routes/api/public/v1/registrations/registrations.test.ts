import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { bulkAsPublicWriter } from '$lib/server/couch-public-writer';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

// vi.mock factories are hoisted above module scope — the mutable state they close
// over has to be hoisted with them.
const { mockEnv, mockAppEnv } = vi.hoisted(() => ({
	mockEnv: { SECRET_RECAPTCHA_KEY: 'test-recaptcha-secret' },
	mockAppEnv: { dev: false }
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({
	get dev() {
		return mockAppEnv.dev;
	}
}));

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/couch-public-writer', () => ({ bulkAsPublicWriter: vi.fn() }));
vi.mock('$lib/server/security/rate-limiter', () => ({
	registerIpLimiter: { check: vi.fn(() => true) },
	registerPhoneLimiter: { check: vi.fn(() => true) }
}));

const verifyToken = vi.fn<(token: string, ip?: string, action?: string) => Promise<boolean>>();
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken(token: string, ip?: string, action?: string) {
			return verifyToken(token, ip, action);
		}
	}
}));

const OPEN_SHELTER = { code: 'SH001', name: 'ศูนย์ทดสอบ', operation_status: 'active' };

const CONTACT = { first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', special_needs: [] };

const VALID_BODY = {
	shelter_code: 'SH001',
	phone: '0812345678',
	members: [CONTACT],
	pets: [],
	captchaToken: 'tok'
};

function event(body: unknown, ip = '203.0.113.5'): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	} as unknown as PostEvent;
}

/** The docs handed to CouchDB, split by type. */
function writtenDocs() {
	const [, docs] = vi.mocked(bulkAsPublicWriter).mock.calls[0];
	const all = docs as unknown as Record<string, unknown>[];
	return {
		all,
		household: all.find((d) => d.type === 'household')!,
		evacuees: all.filter((d) => d.type === 'evacuee')
	};
}

describe('POST /api/public/v1/registrations', () => {
	beforeEach(() => {
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(bulkAsPublicWriter).mockReset();
		vi.mocked(bulkAsPublicWriter).mockResolvedValue({ status: 201, failed: [] });
		vi.mocked(registerIpLimiter.check).mockReturnValue(true);
		vi.mocked(registerPhoneLimiter.check).mockReturnValue(true);
		verifyToken.mockReset();
		verifyToken.mockResolvedValue(true);
		mockEnv.SECRET_RECAPTCHA_KEY = 'test-recaptcha-secret';
		mockAppEnv.dev = false;
	});

	it('422 when the contact last name is blank', async () => {
		const res = await POST(event({ ...VALID_BODY, members: [{ ...CONTACT, last_name: '  ' }] }));
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe('INVALID_INPUT');
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('422 when the phone is not 10 digits — it is the lookup second factor', async () => {
		const res = await POST(event({ ...VALID_BODY, phone: '081234' }));
		expect(res.status).toBe(422);
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('422 with no members at all', async () => {
		const res = await POST(event({ ...VALID_BODY, members: [] }));
		expect(res.status).toBe(422);
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('429 when the IP is rate limited', async () => {
		vi.mocked(registerIpLimiter.check).mockReturnValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(429);
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('429 when the phone is rate limited', async () => {
		vi.mocked(registerPhoneLimiter.check).mockReturnValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(429);
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('400 without a captcha token', async () => {
		const { captchaToken: _drop, ...noToken } = VALID_BODY;
		void _drop;
		const res = await POST(event(noToken));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('CAPTCHA_REQUIRED');
	});

	it('403 when the captcha does not verify', async () => {
		verifyToken.mockResolvedValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('CAPTCHA_FAILED');
	});

	it('404 for a shelter code that is not in the registry', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('SHELTER_NOT_FOUND');
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('409 for a closed shelter (T-71: ศูนย์ closed จองไม่ได้)', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({
			...OPEN_SHELTER,
			operation_status: 'closed'
		} as never);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe('SHELTER_CLOSED');
		expect(bulkAsPublicWriter).not.toHaveBeenCalled();
	});

	it('still books a full shelter — FR-72 says warn, not block', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({
			...OPEN_SHELTER,
			operation_status: 'full_capacity'
		} as never);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(201);
	});

	describe('a solo booking', () => {
		beforeEach(() => {
			vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		});

		it('writes a one-person household plus its member (CR-076)', async () => {
			const res = await POST(event(VALID_BODY));
			expect(res.status).toBe(201);

			const [dbName] = vi.mocked(bulkAsPublicWriter).mock.calls[0];
			expect(dbName).toBe('shelter_sh001');

			const { all, household, evacuees } = writtenDocs();
			expect(all).toHaveLength(2);
			expect(evacuees).toHaveLength(1);
			// Nobody is household-less, not even a solo booker.
			expect(household.label).toBe('ครอบครัวสมชาย ใจดี');
			expect(household.status).toBe('pre_registered');
			expect(household.head_evacuee_id).toBe(evacuees[0]._id);
			expect(evacuees[0].household_id).toBe(household._id);
		});

		it('stamps the envelope the same way staff registration does', async () => {
			await POST(event(VALID_BODY));
			const { evacuees } = writtenDocs();
			const e = evacuees[0];

			expect(e._id).toMatch(/^evacuee:[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(e.schema_v).toBe(7);
			expect(e.shelter_code).toBe('SH001');
			expect(e.created_by).toBe('public');
			expect(e.registered_via).toBe('web');
			expect(e.current_stay).toMatchObject({ status: 'pre_registered', zone: null });
			// Create-only: a _rev would turn an id collision into an overwrite.
			expect(e).not.toHaveProperty('_rev');
		});

		it('splits the single name box into first and last name', async () => {
			await POST(event(VALID_BODY));
			const { evacuees } = writtenDocs();
			expect(evacuees[0].first_name).toBe('สมชาย');
			expect(evacuees[0].last_name).toBe('ใจดี');
		});

		it('ignores client-supplied _id, _rev, current_stay and registered_via', async () => {
			await POST(
				event({
					...VALID_BODY,
					_id: 'evacuee:ATTACKERCHOSENID0000000000',
					_rev: '9-deadbeef',
					current_stay: { status: 'active', zone: 'A' },
					registered_via: 'app'
				})
			);
			const { evacuees } = writtenDocs();
			expect(evacuees[0]._id).not.toBe('evacuee:ATTACKERCHOSENID0000000000');
			expect(evacuees[0]).not.toHaveProperty('_rev');
			expect(evacuees[0].registered_via).toBe('web');
			expect(evacuees[0].current_stay).toMatchObject({ status: 'pre_registered' });
		});
	});

	describe('a family booking', () => {
		const FAMILY = {
			...VALID_BODY,
			national_id: '1234567890123',
			members: [
				CONTACT,
				{
					first_name: 'สมหญิง',
					last_name: 'ใจดี',
					gender: 'female',
					special_needs: ['ผู้สูงอายุ']
				},
				{ first_name: 'เล็ก', last_name: 'ใจดี', gender: 'male', special_needs: ['เด็กเล็ก'] }
			],
			pets: [{ species: 'dog', notes: 'โกโก้', has_cage: true }]
		};

		beforeEach(() => {
			vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		});

		it('writes one evacuee per member, all pointing at the same household', async () => {
			const res = await POST(event(FAMILY));
			expect(res.status).toBe(201);

			const { household, evacuees } = writtenDocs();
			expect(evacuees).toHaveLength(3);
			for (const e of evacuees) {
				expect(e.household_id).toBe(household._id);
				expect(e.current_stay).toMatchObject({ status: 'pre_registered' });
				expect(e.registered_via).toBe('web');
			}
			expect((await res.json()).member_count).toBe(3);
		});

		it('gives the phone and national id to the contact only', async () => {
			await POST(event(FAMILY));
			const { evacuees } = writtenDocs();

			expect(evacuees[0].phone).toBe('0812345678');
			expect(evacuees[0].person_id).toEqual({
				cardType: 'national_id',
				number: '1234567890123'
			});
			expect(evacuees[1].phone).toBeNull();
			expect((evacuees[1].person_id as { number?: string })?.number ?? '').toBe('');
		});

		it('keeps each member’s own vulnerability tags', async () => {
			await POST(event(FAMILY));
			const { evacuees } = writtenDocs();
			expect(evacuees[0].special_needs).toEqual([]);
			expect(evacuees[1].special_needs).toEqual(['ผู้สูงอายุ']);
			expect(evacuees[2].special_needs).toEqual(['เด็กเล็ก']);
		});

		it('records pets on the household (CR-016)', async () => {
			await POST(event(FAMILY));
			const { household } = writtenDocs();
			expect(household.pets).toEqual([
				{ species: 'dog', count: 1, notes: 'โกโก้', has_cage: true }
			]);
		});

		// `species` is a shelter-configured `pet_types` code (master data), not a
		// fixed enum — a shelter can offer species beyond the legacy dog/cat/bird/
		// other set. The request must still validate (422 would silently break
		// booking for that shelter's citizens), even though the value has no
		// special meaning to the household schema.
		it('accepts a pet species outside the legacy dog/cat/bird/other set', async () => {
			const res = await POST(
				event({ ...FAMILY, pets: [{ species: 'rabbit', notes: 'กระต่าย', has_cage: false }] })
			);
			expect(res.status).toBe(201);

			const { household } = writtenDocs();
			expect(household.pets).toEqual([
				{ species: 'other', count: 1, notes: 'กระต่าย — ชนิด: rabbit', has_cage: false }
			]);
		});

		it('422 when a pet has no species selected', async () => {
			const res = await POST(event({ ...FAMILY, pets: [{ species: '', has_cage: false }] }));
			expect(res.status).toBe(422);
			expect(bulkAsPublicWriter).not.toHaveBeenCalled();
		});
	});

	it('502 when CouchDB rejects any row of the bulk write', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		vi.mocked(bulkAsPublicWriter).mockResolvedValue({
			status: 201,
			failed: [{ id: 'evacuee:X', reason: 'forbidden' }]
		});
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(502);
		expect((await res.json()).error).toBe('WRITE_FAILED');
	});

	// CR-070 requires CAPTCHA on the public plane. A developer without Google keys
	// must still be able to run the flow, but a production deploy that forgets the
	// secret must be rejected rather than silently unguarded.
	describe('when SECRET_RECAPTCHA_KEY is a placeholder', () => {
		beforeEach(() => {
			mockEnv.SECRET_RECAPTCHA_KEY = 'google_secret_key';
			vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		});

		it('500s in production rather than accepting an unguarded booking', async () => {
			mockAppEnv.dev = false;
			const res = await POST(event(VALID_BODY));
			expect(res.status).toBe(500);
			expect((await res.json()).error).toBe('SERVER_MISCONFIGURED');
			expect(bulkAsPublicWriter).not.toHaveBeenCalled();
		});

		it('skips verification in dev so the form is usable without Google keys', async () => {
			mockAppEnv.dev = true;
			const { captchaToken: _drop, ...noToken } = VALID_BODY;
			void _drop;

			const res = await POST(event(noToken));
			expect(res.status).toBe(201);
			expect(verifyToken).not.toHaveBeenCalled();
		});

		it('still enforces the rate limit in dev', async () => {
			mockAppEnv.dev = true;
			vi.mocked(registerIpLimiter.check).mockReturnValue(false);
			const res = await POST(event(VALID_BODY));
			expect(res.status).toBe(429);
			expect(bulkAsPublicWriter).not.toHaveBeenCalled();
		});
	});

	it('never returns PII on the ticket (Public task DoD)', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		const body = await (await POST(event({ ...VALID_BODY, national_id: '1234567890123' }))).json();

		expect(Object.keys(body).sort()).toEqual([
			'booked_at',
			'code',
			'first_name',
			'member_count',
			'pet_count',
			'shelter_code',
			'shelter_name',
			'status',
			'success'
		]);
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain('0812345678');
		expect(serialized).not.toContain('1234567890123');
		expect(serialized).not.toContain('ใจดี'); // last name stays off the public ticket
	});
});

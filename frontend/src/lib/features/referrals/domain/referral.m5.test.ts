import { describe, expect, it } from 'vitest';
import {
	ExternallyManagedError,
	M5PayloadError,
	M5_REFERRAL_SCHEMA_V,
	assertM5TransitionAllowed,
	buildM5BatchReferralBodies,
	buildM5TransferPayload,
	defaultAcuity,
	externalRefFor,
	isM5Referral,
	m5BatchInputSchema,
	referralStatusForM5,
	type M5EvacueeSource
} from './referral.m5';
import { applyTransition } from './referral.transitions';
import {
	canActorRespond,
	canManageReferralType,
	referralTypesForRoles
} from './referral.authorization';
import { referralBatchKey } from './referral.batch-group';
import { getReferralActions } from './referral.bulk-actions';
import { isReferral, referralSchema, type Referral } from './referral.schema';

const BATCH = '01JC00000000000000000BATCH';

function m5Referral(over: Record<string, unknown> = {}): Referral {
	return referralSchema.parse({
		_id: 'referral:01JC000000000000000000000A',
		type: 'referral',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-11-11T01:00:00.000Z',
		updated_at: '2026-11-11T01:00:00.000Z',
		created_by: 'manager1',
		evacuee_id: 'evacuee:A',
		referral_type: 'medical-emergency',
		dispatch_mode: 'm5',
		batch_id: BATCH,
		to_org: { name: 'รพ.สนามหาดใหญ่', kind: 'hospital', m5_facility_id: 6 },
		acuity: 'red',
		transport: { vehicle_type: 'van', note: 'รถตู้ศูนย์' },
		requester_contact: { name: 'สมชาย', role: 'หัวหน้าศูนย์', phone: '0812345678' },
		reason: 'หายใจลำบาก',
		urgency: 'urgent',
		status: 'draft',
		timeline: {},
		...over
	});
}

const trackingReferral = (): Referral =>
	referralSchema.parse({
		...m5Referral(),
		schema_v: 2,
		dispatch_mode: undefined,
		batch_id: undefined,
		acuity: undefined,
		transport: undefined,
		requester_contact: undefined
	});

const shelter = { code: 'SH001', name: 'ศูนย์ทดสอบ', location: { lat: 7.0084, lng: 100.4747 } };

const evacuees = new Map<string, M5EvacueeSource>([
	[
		'evacuee:A',
		{
			first_name: 'สมศรี',
			last_name: 'ใจดี',
			person_id: { cardType: 'national_id', number: '1-1017-00203-45-0' },
			age: 67
		}
	],
	['evacuee:B', { first_name: 'ไม่มี', last_name: '', birth_year: 2539 }]
]);

describe('schema_v 3 reader', () => {
	it('keeps every M5 field', () => {
		const r = m5Referral({
			status: 'sent',
			external: {
				system: 'm5',
				external_ref: `TENT-SH001-${BATCH}`,
				code: 'TRF-20261111-0001',
				status: 'awaiting_review'
			}
		});
		expect(isReferral(r)).toBe(true);
		expect(r).toMatchObject({
			schema_v: 3,
			dispatch_mode: 'm5',
			batch_id: BATCH,
			acuity: 'red',
			to_org: { m5_facility_id: 6 },
			external: { code: 'TRF-20261111-0001' }
		});
	});

	it('rejects an unknown M5 status', () => {
		const raw = {
			...m5Referral(),
			external: { system: 'm5', external_ref: 'x', code: 'y', status: 'teleported' }
		};
		expect(referralSchema.safeParse(raw).success).toBe(false);
	});

	it('does not lower a v3 doc to v2 when closing with a reason', () => {
		const sent = m5Referral({
			status: 'accepted',
			external: { system: 'm5', external_ref: 'x', code: 'y', status: 'arrived' }
		});
		expect(
			applyTransition(sent, 'closed', 'm', '2026-11-11T02:00:00.000Z', 'ถึงแล้ว').schema_v
		).toBe(M5_REFERRAL_SCHEMA_V);
	});
});

describe('isM5Referral / externalRefFor / referralStatusForM5 / defaultAcuity', () => {
	it('tells m5 from tracking', () => {
		expect(isM5Referral(m5Referral())).toBe(true);
		expect(isM5Referral(trackingReferral())).toBe(false);
	});

	it('builds a stable external_ref and refuses one over 64 chars', () => {
		expect(externalRefFor('SH001', BATCH)).toBe(`TENT-SH001-${BATCH}`);
		expect(() => externalRefFor('SH001', 'x'.repeat(60))).toThrow(M5PayloadError);
	});

	it.each([
		['awaiting_review', 'sent'],
		['pending', 'accepted'],
		['in_transit', 'accepted'],
		['rejected', 'rejected'],
		['arrived', 'closed'],
		['cancelled', 'closed']
	] as const)('maps %s to %s', (m5, referral) => {
		expect(referralStatusForM5(m5)).toBe(referral);
	});

	it('defaults acuity from the legacy triage level only', () => {
		expect(defaultAcuity({ triage_level: 'yellow' })).toBe('yellow');
		expect(defaultAcuity({ triage_level: null })).toBeUndefined();
		expect(defaultAcuity(undefined)).toBeUndefined();
	});
});

describe('assertM5TransitionAllowed (CR §4 rules 1–4)', () => {
	it('never lets a user accept or reject an m5 referral', () => {
		const sent = m5Referral({ status: 'sent' });
		for (const channel of ['row', 'batch'] as const) {
			expect(() => assertM5TransitionAllowed(sent, 'accepted', channel)).toThrow(
				ExternallyManagedError
			);
			expect(() => assertM5TransitionAllowed(sent, 'rejected', channel)).toThrow(
				ExternallyManagedError
			);
		}
		expect(() => assertM5TransitionAllowed(sent, 'accepted', 'system')).not.toThrow();
	});

	it('sends and withdraws only through the batch endpoint', () => {
		expect(() => assertM5TransitionAllowed(m5Referral(), 'sent', 'row')).toThrow(
			ExternallyManagedError
		);
		expect(() => assertM5TransitionAllowed(m5Referral(), 'sent', 'batch')).not.toThrow();
		const sent = m5Referral({ status: 'sent' });
		expect(() => assertM5TransitionAllowed(sent, 'closed', 'row')).toThrow(ExternallyManagedError);
		expect(() => assertM5TransitionAllowed(sent, 'closed', 'batch')).not.toThrow();
	});

	it('lets a single draft be cancelled before the batch is sent', () => {
		expect(() => assertM5TransitionAllowed(m5Referral(), 'closed', 'row')).not.toThrow();
	});

	it('closes an accepted referral by hand only after M5 arrived or cancelled', () => {
		const ext = (status: string) => ({ system: 'm5', external_ref: 'x', code: 'y', status });
		const accepted = (status: string) => m5Referral({ status: 'accepted', external: ext(status) });
		expect(() => assertM5TransitionAllowed(accepted('in_transit'), 'closed', 'row')).toThrow(
			ExternallyManagedError
		);
		expect(() => assertM5TransitionAllowed(accepted('arrived'), 'closed', 'row')).not.toThrow();
		expect(() => assertM5TransitionAllowed(accepted('cancelled'), 'closed', 'row')).not.toThrow();
	});

	it('leaves tracking referrals alone', () => {
		const sent = { ...trackingReferral(), status: 'sent' as const };
		expect(() => assertM5TransitionAllowed(sent, 'accepted', 'row')).not.toThrow();
		expect(() => assertM5TransitionAllowed(sent, 'closed', 'row')).not.toThrow();
	});

	it('hides accept/reject buttons for m5 referrals', () => {
		expect(canActorRespond(m5Referral({ status: 'sent' }), 'SH001')).toBe(false);
		expect(canActorRespond({ ...trackingReferral(), status: 'sent' }, 'SH001')).toBe(true);
	});
});

describe('role → referral types (D8, D16)', () => {
	const nurse = ['shelter:SH001', 'SH001:medical_staff'];
	const manager = ['shelter:SH001', 'SH001:shelter_manager'];

	it('gives managers and SA every type', () => {
		expect(referralTypesForRoles(manager, 'SH001')).toBeNull();
		expect(referralTypesForRoles(['system_admin'], 'SH001')).toBeNull();
	});

	it('limits medical staff to medical-emergency in their own shelter', () => {
		expect(referralTypesForRoles(nurse, 'SH001')).toEqual(['medical-emergency']);
		expect(canManageReferralType(nurse, 'SH001', 'medical-emergency')).toBe(true);
		expect(canManageReferralType(nurse, 'SH001', 'capacity')).toBe(false);
		expect(canManageReferralType(nurse, 'SH002', 'medical-emergency')).toBe(false);
	});

	it('gives other staff nothing', () => {
		expect(referralTypesForRoles(['shelter:SH001', 'SH001:kitchen_staff'], 'SH001')).toEqual([]);
	});
});

describe('batch grouping', () => {
	it('groups by batch_id regardless of reason or time', () => {
		const a = m5Referral();
		const b = m5Referral({
			_id: 'referral:01JC000000000000000000000B',
			reason: 'ต่างกัน',
			created_at: '2026-11-11T09:00:00.000Z'
		});
		expect(referralBatchKey(a)).toBe(`batch:${BATCH}`);
		expect(referralBatchKey(b)).toBe(referralBatchKey(a));
	});
});

describe('m5BatchInputSchema + buildM5BatchReferralBodies', () => {
	const input = {
		to_org: { name: 'รพ.สนามหาดใหญ่', m5_facility_id: 6 },
		urgency: 'urgent',
		transport: { vehicle_type: 'van' },
		requester_contact: { name: 'สมชาย', role: 'หัวหน้า', phone: '081' },
		patients: [
			{ evacuee_id: 'evacuee:A', acuity: 'red', reason: 'หายใจลำบาก' },
			{ evacuee_id: 'evacuee:B', acuity: 'green', reason: 'ไข้' }
		]
	};

	it('defaults submit to false and rejects duplicate patients', () => {
		expect(m5BatchInputSchema.parse(input).submit).toBe(false);
		const dup = { ...input, patients: [input.patients[0], input.patients[0]] };
		expect(m5BatchInputSchema.safeParse(dup).success).toBe(false);
		expect(m5BatchInputSchema.safeParse({ ...input, patients: [] }).success).toBe(false);
	});

	it('builds one draft per patient sharing the batch fields', () => {
		const bodies = buildM5BatchReferralBodies(m5BatchInputSchema.parse(input), BATCH, new Map());
		expect(bodies).toHaveLength(2);
		for (const b of bodies) {
			expect(b).toMatchObject({
				referral_type: 'medical-emergency',
				dispatch_mode: 'm5',
				batch_id: BATCH,
				status: 'draft',
				urgency: 'urgent',
				to_org: { name: 'รพ.สนามหาดใหญ่', kind: 'hospital', m5_facility_id: 6 }
			});
		}
		expect(bodies.map((b) => [b.acuity, b.reason])).toEqual([
			['red', 'หายใจลำบาก'],
			['green', 'ไข้']
		]);
	});
});

describe('buildM5TransferPayload', () => {
	const a = m5Referral();
	const b = m5Referral({
		_id: 'referral:01JC000000000000000000000B',
		evacuee_id: 'evacuee:B',
		acuity: 'yellow',
		reason: 'ไข้สูง'
	});
	const now = new Date('2026-11-11T00:00:00Z');

	it('builds a deterministic TRF-002 body ordered by referral id', () => {
		const body = buildM5TransferPayload({ referrals: [b, a], evacuees, shelter, now });
		expect(body).toEqual(buildM5TransferPayload({ referrals: [a, b], evacuees, shelter, now }));
		expect(body).toMatchObject({
			shelter_code: 'SH001',
			batch_id: BATCH,
			external_ref: `TENT-SH001-${BATCH}`,
			origin: { location_code: 'SH001', latitude: 7.0084, longitude: 100.4747 },
			requester: {
				contact_name: 'สมชาย',
				contact_role: 'หัวหน้าศูนย์',
				contact_phone: '0812345678'
			},
			destination_facility_id: 6,
			transport_vehicle_type: 'van',
			transport_note: 'รถตู้ศูนย์'
		});
		expect(body.patients).toEqual([
			{
				referral_id: a._id,
				acuity: 'red',
				name: 'สมศรี ใจดี',
				national_id: '1101700203450',
				age: 67,
				condition: 'หายใจลำบาก'
			},
			{ referral_id: b._id, acuity: 'yellow', name: 'ไม่มี', age: 30, condition: 'ไข้สูง' }
		]);
	});

	it('omits national ids that are not a 13-digit Thai ID', () => {
		const odd = new Map<string, M5EvacueeSource>([
			['evacuee:A', { first_name: 'A', person_id: { cardType: 'passport', number: 'AA1234567' } }]
		]);
		const body = buildM5TransferPayload({ referrals: [a], evacuees: odd, shelter, now });
		expect(body.patients[0]).not.toHaveProperty('national_id');
		expect(body.patients[0]).not.toHaveProperty('age');
	});

	it.each([
		[
			'SHELTER_LOCATION_MISSING',
			{ referrals: [a], evacuees, shelter: { ...shelter, location: null } }
		],
		[
			'SHELTER_LOCATION_MISSING',
			{ referrals: [a], evacuees, shelter: { ...shelter, location: { lat: 0, lng: 0 } } }
		],
		['EMPTY_BATCH', { referrals: [], evacuees, shelter }],
		['NOT_M5_BATCH', { referrals: [trackingReferral()], evacuees, shelter }],
		['EVACUEE_NOT_FOUND', { referrals: [a], evacuees: new Map(), shelter }],
		['MISSING_ACUITY', { referrals: [m5Referral({ acuity: undefined })], evacuees, shelter }],
		[
			'BATCH_INCONSISTENT',
			{
				referrals: [
					a,
					{ ...b, to_org: { name: 'อื่น', kind: 'hospital' as const, m5_facility_id: 2 } }
				],
				evacuees,
				shelter
			}
		]
	] as const)('throws %s', (code, args) => {
		expect(() => buildM5TransferPayload({ ...args, now })).toThrow(
			expect.objectContaining({ code })
		);
	});
});

describe('row/bulk actions for m5 referrals', () => {
	const ext = (status: string) => ({ system: 'm5', external_ref: 'x', code: 'y', status });

	it('offers no per-row send for an m5 draft, but lets it be cancelled', () => {
		expect(getReferralActions(m5Referral(), 'SH001')).toEqual(['cancel_draft']);
	});

	it('offers withdraw (whole batch, D11) but never accept/reject on a sent m5 referral', () => {
		const sent = m5Referral({ status: 'sent', external: ext('awaiting_review') });
		expect(getReferralActions(sent, 'SH001')).toEqual(['withdraw']);
	});

	it('closes an accepted m5 referral only after M5 arrived or cancelled', () => {
		expect(
			getReferralActions(m5Referral({ status: 'accepted', external: ext('in_transit') }), 'SH001')
		).toEqual([]);
		expect(
			getReferralActions(m5Referral({ status: 'accepted', external: ext('arrived') }), 'SH001')
		).toEqual(['close']);
	});
});

/**
 * M5 hospital referral — pure domain rules (draft CR — referral M5 integration §3, §4).
 *
 * Pure TypeScript / Zod — No I/O, No Svelte.
 *
 * - A batch (`batch_id`) is one M5 transfer; every referral in it shares destination,
 *   transport, requester contact and urgency, while `acuity` and `reason` are per patient.
 * - `external_ref` = `TENT-{shelter_code}-{batch_id}`: the M5 idempotency key, so a retry of
 *   the same batch never creates a second transfer.
 * - Status of an `m5` referral comes from M5 only (rules 1–4).
 */

import { z } from 'zod';
import { ageFromBirthYearBE } from '$lib/features/people/domain/birth-calendar';
import {
	acuitySchema,
	referralTransportSchema,
	referralUrgencySchema,
	requesterContactSchema,
	type Acuity,
	type EvacueeSummary,
	type M5TransferStatus,
	type Referral,
	type ReferralStatus
} from './referral.schema';

/** schema_v stamped on `dispatch_mode = m5` referrals (D15). Tracking referrals stay on 2. */
export const M5_REFERRAL_SCHEMA_V = 3;

const EXTERNAL_REF_MAX = 64;
const NATIONAL_ID_DIGITS = 13;
const MAX_AGE = 150;

// ---------------------------------------------------------------------------
// Batch create input (FR-B1–B3)
// ---------------------------------------------------------------------------

export const m5BatchPatientInputSchema = z.object({
	evacuee_id: z.string().startsWith('evacuee:', 'กรุณาเลือกผู้ประสบภัย'),
	acuity: acuitySchema,
	reason: z.string().trim().min(1, 'กรุณาระบุอาการ').max(2000)
});
export type M5BatchPatientInput = z.infer<typeof m5BatchPatientInputSchema>;

export const m5BatchInputSchema = z.object({
	to_org: z.object({
		name: z.string().trim().min(1, 'กรุณาเลือกโรงพยาบาลปลายทาง'),
		m5_facility_id: z.number().int().positive(),
		contact: z.string().trim().optional()
	}),
	urgency: referralUrgencySchema,
	transport: referralTransportSchema,
	requester_contact: requesterContactSchema,
	notes: z.string().max(2000).optional(),
	patients: z
		.array(m5BatchPatientInputSchema)
		.min(1, 'กรุณาเลือกผู้ป่วยอย่างน้อย 1 คน')
		.refine((ps) => new Set(ps.map((p) => p.evacuee_id)).size === ps.length, {
			message: 'เลือกผู้ป่วยซ้ำ'
		}),
	/** true = create the batch and submit it to M5 in one press ("ส่งข้อมูล", FR-B3). */
	submit: z.boolean().default(false)
});
export type M5BatchInput = z.infer<typeof m5BatchInputSchema>;

/**
 * Draft referral bodies for one M5 batch — one per patient, all sharing `batchId`.
 * Envelope fields (`_id`, `schema_v`, timestamps, author) are added by the caller's `makeDoc`.
 */
export function buildM5BatchReferralBodies(
	input: M5BatchInput,
	batchId: string,
	summaries: ReadonlyMap<string, EvacueeSummary | undefined>
) {
	return input.patients.map((p) => ({
		referral_type: 'medical-emergency' as const,
		dispatch_mode: 'm5' as const,
		batch_id: batchId,
		evacuee_id: p.evacuee_id,
		evacuee_summary: summaries.get(p.evacuee_id),
		reason: p.reason,
		acuity: p.acuity,
		urgency: input.urgency,
		notes: input.notes,
		to_shelter_code: undefined,
		to_org: {
			name: input.to_org.name,
			kind: 'hospital' as const,
			m5_facility_id: input.to_org.m5_facility_id,
			...(input.to_org.contact ? { contact: input.to_org.contact } : {})
		},
		transport: input.transport,
		requester_contact: input.requester_contact,
		status: 'draft' as const,
		timeline: {}
	}));
}

// ---------------------------------------------------------------------------
// Identity & status mapping
// ---------------------------------------------------------------------------

export function isM5Referral(r: Referral): boolean {
	return (
		r.referral_type === 'medical-emergency' && 'dispatch_mode' in r && r.dispatch_mode === 'm5'
	);
}

/** M5 idempotency key for a batch. Never reused, even after reject/cancel (M5 guide). */
export function externalRefFor(shelterCode: string, batchId: string): string {
	const ref = `TENT-${shelterCode}-${batchId}`;
	if (ref.length > EXTERNAL_REF_MAX) {
		throw new M5PayloadError('EXTERNAL_REF_TOO_LONG', `external_ref exceeds ${EXTERNAL_REF_MAX}`);
	}
	return ref;
}

/** Referral status an M5 transfer status maps to (CR §4 table). */
export function referralStatusForM5(status: M5TransferStatus): ReferralStatus {
	switch (status) {
		case 'awaiting_review':
			return 'sent';
		case 'pending':
		case 'in_transit':
			return 'accepted';
		case 'rejected':
			return 'rejected';
		case 'arrived':
		case 'cancelled':
			return 'closed';
	}
}

/**
 * UI default for a patient's acuity (D13): the legacy screening `triage_level` when present
 * (deprecated since CR-106, so usually absent); otherwise none and staff must pick.
 */
export function defaultAcuity(
	screening: { triage_level?: 'green' | 'yellow' | 'red' | null } | null | undefined
): Acuity | undefined {
	return screening?.triage_level ?? undefined;
}

// ---------------------------------------------------------------------------
// Transition guard (CR §4 rules 1–4)
// ---------------------------------------------------------------------------

/** Who drives a transition: a single-row endpoint, a batch endpoint, or the M5 sync worker. */
export type ReferralTransitionChannel = 'row' | 'batch' | 'system';

export class ExternallyManagedError extends Error {
	readonly code = 'EXTERNALLY_MANAGED';
	constructor(message: string) {
		super(message);
		this.name = 'ExternallyManagedError';
	}
}

const M5_MANUAL_CLOSE_STATUSES: readonly M5TransferStatus[] = ['arrived', 'cancelled'];

/**
 * Throws `ExternallyManagedError` when a user transition would bypass M5. No-op for
 * `tracking` referrals and for the sync worker (`system`).
 */
export function assertM5TransitionAllowed(
	referral: Referral,
	to: ReferralStatus,
	channel: ReferralTransitionChannel
): void {
	if (!isM5Referral(referral) || channel === 'system') return;

	if (to === 'accepted' || to === 'rejected') {
		throw new ExternallyManagedError('ผลพิจารณาของใบนี้มาจาก OneData (M5) เท่านั้น');
	}
	if (channel === 'row') {
		if (referral.status === 'draft' && to === 'sent') {
			throw new ExternallyManagedError('ใบนี้ต้องส่งทั้งชุดผ่าน OneData (M5)');
		}
		if (referral.status === 'sent' && to === 'closed') {
			throw new ExternallyManagedError('ใบนี้ต้องถอนทั้งชุดผ่าน OneData (M5)');
		}
	}
	if (referral.status === 'accepted' && to === 'closed') {
		const external = 'external' in referral ? referral.external : undefined;
		if (!external || !M5_MANUAL_CLOSE_STATUSES.includes(external.status)) {
			throw new ExternallyManagedError(
				'ปิดรายการได้หลังผู้ป่วยถึงโรงพยาบาลหรือ OneData ยกเลิกใบแล้วเท่านั้น'
			);
		}
	}
}

// ---------------------------------------------------------------------------
// TRF-002 payload (assembled server-side by the BFF; CR §1, §3)
// ---------------------------------------------------------------------------

export type M5PayloadErrorCode =
	| 'EMPTY_BATCH'
	| 'NOT_M5_BATCH'
	| 'BATCH_INCONSISTENT'
	| 'MISSING_ACUITY'
	| 'EVACUEE_NOT_FOUND'
	| 'SHELTER_LOCATION_MISSING'
	| 'EXTERNAL_REF_TOO_LONG';

export class M5PayloadError extends Error {
	constructor(
		readonly code: M5PayloadErrorCode,
		message: string
	) {
		super(message);
		this.name = 'M5PayloadError';
	}
}

/** The evacuee fields the payload reads (structural, so callers pass a full `Evacuee`). */
export type M5EvacueeSource = {
	first_name: string;
	last_name?: string;
	person_id?: { cardType?: string | null; number?: string | null } | null;
	age?: number | null;
	birth_year?: number | null;
};

export type M5ShelterSource = {
	code: string;
	name: string;
	location?: { lat?: number | null; lng?: number | null } | null;
};

/** Body of FastAPI `POST /v1/integrations/m5/transfers` (minus `actor`). */
export type M5TransferRequest = {
	shelter_code: string;
	batch_id: string;
	external_ref: string;
	origin: { location_code: string; location_name: string; latitude: number; longitude: number };
	requester: { contact_name: string; contact_role: string; contact_phone: string };
	destination_facility_id: number;
	transport_vehicle_type: string;
	transport_note: string;
	note: string;
	patients: {
		referral_id: string;
		acuity: Acuity;
		name?: string;
		national_id?: string;
		age?: number;
		condition?: string;
	}[];
};

function nationalIdOf(e: M5EvacueeSource): string | undefined {
	const pid = e.person_id;
	if (!pid?.number) return undefined;
	if ((pid.cardType ?? 'national_id') !== 'national_id') return undefined;
	const digits = pid.number.replace(/\D/g, '');
	// M5 rejects anything but 13 digits; send nothing rather than block the batch (D10).
	return digits.length === NATIONAL_ID_DIGITS ? digits : undefined;
}

function ageOf(e: M5EvacueeSource, now: Date): number | undefined {
	const age = e.age ?? (e.birth_year ? ageFromBirthYearBE(e.birth_year, now) : undefined);
	if (age === undefined || age === null || !Number.isFinite(age)) return undefined;
	return Math.min(MAX_AGE, Math.max(0, Math.trunc(age)));
}

function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Build the TRF-002 request for one batch. Patients are ordered by referral `_id` so the same
 * batch always yields the same body (M5 replays identical bodies idempotently).
 *
 * @throws {M5PayloadError} when the batch cannot be sent as one M5 transfer.
 */
export function buildM5TransferPayload(input: {
	referrals: readonly Referral[];
	evacuees: ReadonlyMap<string, M5EvacueeSource>;
	shelter: M5ShelterSource;
	now?: Date;
}): M5TransferRequest {
	const { evacuees, shelter, now = new Date() } = input;
	const referrals = [...input.referrals].sort((a, b) => a._id.localeCompare(b._id));
	const first = referrals[0];
	if (!first) throw new M5PayloadError('EMPTY_BATCH', 'ไม่มีผู้ป่วยในชุด');
	if (!referrals.every(isM5Referral)) {
		throw new M5PayloadError('NOT_M5_BATCH', 'ชุดนี้ไม่ใช่การส่งผ่าน OneData (M5)');
	}
	const m5 = referrals as (Referral & {
		batch_id?: string;
		acuity?: Acuity;
		transport?: { vehicle_type: string; note?: string };
		requester_contact?: { name: string; role: string; phone: string };
	})[];
	const head = m5[0]!;

	const shared = (r: (typeof m5)[number]) => ({
		batch_id: r.batch_id,
		shelter_code: r.shelter_code,
		facility: r.to_org?.m5_facility_id,
		transport: r.transport,
		requester: r.requester_contact,
		urgency: r.urgency
	});
	if (!head.batch_id || !m5.every((r) => sameJson(shared(r), shared(head)))) {
		throw new M5PayloadError('BATCH_INCONSISTENT', 'ข้อมูลร่วมของชุดไม่ตรงกัน');
	}
	const facilityId = head.to_org?.m5_facility_id;
	if (!facilityId || !head.transport || !head.requester_contact) {
		throw new M5PayloadError('BATCH_INCONSISTENT', 'ชุดนี้ยังไม่มีปลายทาง พาหนะ หรือผู้ติดต่อ');
	}

	const lat = shelter.location?.lat;
	const lng = shelter.location?.lng;
	if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0)) {
		throw new M5PayloadError(
			'SHELTER_LOCATION_MISSING',
			'ศูนย์นี้ยังไม่ได้ตั้งพิกัด กรุณาตั้งพิกัดศูนย์ก่อนส่งผ่าน OneData (M5)'
		);
	}

	const patients = m5.map((r) => {
		if (!r.acuity) throw new M5PayloadError('MISSING_ACUITY', 'กรุณาเลือกระดับความรุนแรงให้ครบ');
		const e = evacuees.get(r.evacuee_id);
		if (!e) throw new M5PayloadError('EVACUEE_NOT_FOUND', 'ไม่พบข้อมูลผู้ป่วยบางคนในศูนย์');
		const name = `${e.first_name} ${e.last_name ?? ''}`.trim();
		const nationalId = nationalIdOf(e);
		const age = ageOf(e, now);
		return {
			referral_id: r._id,
			acuity: r.acuity,
			...(name ? { name } : {}),
			...(nationalId ? { national_id: nationalId } : {}),
			...(age !== undefined ? { age } : {}),
			condition: r.reason
		};
	});

	return {
		shelter_code: head.shelter_code,
		batch_id: head.batch_id,
		external_ref: externalRefFor(head.shelter_code, head.batch_id),
		origin: {
			location_code: shelter.code,
			location_name: shelter.name,
			latitude: lat,
			longitude: lng
		},
		requester: {
			contact_name: head.requester_contact.name,
			contact_role: head.requester_contact.role,
			contact_phone: head.requester_contact.phone
		},
		destination_facility_id: facilityId,
		transport_vehicle_type: head.transport.vehicle_type,
		transport_note: head.transport.note ?? '',
		note: head.notes ?? '',
		patients
	};
}

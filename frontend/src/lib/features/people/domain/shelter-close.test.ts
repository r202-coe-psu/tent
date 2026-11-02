import { describe, it, expect } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	applyMovementToStay,
	assertMovementAllowed,
	assertShelterCloseCheckoutAllowed,
	buildShelterCloseCancel,
	buildShelterCloseCancelAudit,
	buildShelterCloseCheckout,
	checkoutDestinationSchema,
	createEvacuee,
	createHousehold,
	createMovement,
	deriveShelterCloseHousehold,
	isShelterCloseAffectedStatus,
	MANUAL_CHECKOUT_DESTINATION_TYPES,
	movementReasonLabel,
	SHELTER_CLOSE_CANCEL_STATUSES,
	SHELTER_CLOSE_CHECKOUT_STATUSES,
	SHELTER_CLOSED_REASON,
	type Evacuee,
	type StayStatus
} from './people';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'mgr1' };
const AT = '2026-11-01T08:00:00.000Z';

function evacueeIn(status: StayStatus, householdId: string | null = 'household:H1'): Evacuee {
	const e = createEvacuee(
		{ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null },
		ctx,
		null
	);
	return {
		...e,
		household_id: householdId,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' }
	};
}

describe('CR-219 FR-1 — checkout destination shelter_closed', () => {
	it('accepts shelter_closed in the schema but keeps it out of the manual dropdown', () => {
		expect(checkoutDestinationSchema.safeParse({ type: 'shelter_closed' }).success).toBe(true);
		expect(MANUAL_CHECKOUT_DESTINATION_TYPES).not.toContain('shelter_closed');
		expect(MANUAL_CHECKOUT_DESTINATION_TYPES).toEqual([
			'returned_home',
			'transferred_shelter',
			'referred_facility',
			'other'
		]);
	});

	it('labels the shelter_closed reason and passes free text through (FR-21)', () => {
		expect(movementReasonLabel(SHELTER_CLOSED_REASON)).toBe('ศูนย์ปิด');
		expect(movementReasonLabel('กลับบ้าน')).toBe('กลับบ้าน');
		expect(movementReasonLabel(null)).toBe('');
	});
});

describe('CR-219 FR-2 — statuses in scope', () => {
	it('checks out five stay statuses and cancels pre_registered', () => {
		expect(SHELTER_CLOSE_CHECKOUT_STATUSES).toEqual([
			'active',
			'room_confirmed',
			'temporary_leave',
			'arriving',
			'kiosk_registered'
		]);
		expect(SHELTER_CLOSE_CANCEL_STATUSES).toEqual(['pre_registered']);
	});

	it.each(['transferred', 'checked_out', 'deceased', 'cancelled'] as const)(
		'leaves %s alone',
		(status) => {
			expect(isShelterCloseAffectedStatus(status)).toBe(false);
		}
	);
});

describe('CR-219 FR-3 — system-close check-out guard', () => {
	it.each(['temporary_leave', 'arriving', 'kiosk_registered'] as const)(
		'normal check-out still rejects %s',
		(status) => {
			expect(() =>
				assertMovementAllowed(evacueeIn(status), 'check_out', { reason: SHELTER_CLOSED_REASON })
			).toThrow(/เช็คเอาท์/);
		}
	);

	it.each(SHELTER_CLOSE_CHECKOUT_STATUSES)('system close allows %s', (status) => {
		expect(() =>
			assertMovementAllowed(evacueeIn(status), 'check_out', {
				reason: SHELTER_CLOSED_REASON,
				systemClose: true
			})
		).not.toThrow();
	});

	it('system close requires the shelter_closed reason', () => {
		expect(() => assertShelterCloseCheckoutAllowed(evacueeIn('active'), 'กลับบ้าน')).toThrow(
			/shelter_closed/
		);
	});

	it('system close rejects stays outside scope and non check-out actions', () => {
		expect(() =>
			assertShelterCloseCheckoutAllowed(evacueeIn('pre_registered'), SHELTER_CLOSED_REASON)
		).toThrow();
		expect(() =>
			assertMovementAllowed(evacueeIn('active'), 'transfer_out', { systemClose: true })
		).toThrow(/เช็คเอาท์/);
	});

	it('applyMovementToStay needs the systemClose flag for temporary_leave', () => {
		const e = evacueeIn('temporary_leave');
		const m = createMovement(
			{ evacuee_id: e._id, action: 'check_out', zone: null, reason: SHELTER_CLOSED_REASON },
			ctx
		);
		expect(() => applyMovementToStay(e, m)).toThrow();
		expect(applyMovementToStay(e, m, { systemClose: true }).current_stay.status).toBe(
			'checked_out'
		);
	});
});

describe('CR-219 FR-4 — buildShelterCloseCheckout', () => {
	it.each(SHELTER_CLOSE_CHECKOUT_STATUSES)('checks out %s through a movement', (status) => {
		const { movement, evacuee } = buildShelterCloseCheckout(evacueeIn(status), ctx, AT);
		expect(movement).toMatchObject({
			type: 'movement',
			action: 'check_out',
			reason: 'shelter_closed',
			zone: null,
			occurred_at: AT,
			created_by: 'mgr1',
			shelter_code: 'SH001'
		});
		expect(movement.evacuee_id).toBe(evacuee._id);
		expect(evacuee.current_stay).toMatchObject({ status: 'checked_out', since: AT });
		expect(evacuee.household_id).toBe('household:H1');
	});

	it('refuses pre_registered (that path cancels instead)', () => {
		expect(() => buildShelterCloseCheckout(evacueeIn('pre_registered'), ctx, AT)).toThrow();
	});
});

describe('CR-219 FR-6 — buildShelterCloseCancel', () => {
	it('cancels pre_registered with hold-cancel semantics', () => {
		const e = buildShelterCloseCancel(evacueeIn('pre_registered'), AT);
		expect(e.current_stay).toMatchObject({ status: 'cancelled', since: AT });
	});

	it('refuses any other status', () => {
		expect(() => buildShelterCloseCancel(evacueeIn('active'), AT)).toThrow();
	});

	it('builds one household audit with reason shelter_closed (FR-6a)', () => {
		const audit = buildShelterCloseCancelAudit('household:H1', ['evacuee:A', 'evacuee:B'], ctx);
		expect(audit).toMatchObject({
			type: 'audit',
			action: 'other',
			target_type: 'household',
			target_id: 'household:H1',
			reason: 'shelter_closed',
			context: { cancelled_member_count: 2, evacuee_ids: ['evacuee:A', 'evacuee:B'] }
		});
	});
});

describe('CR-219 FR-5 / FR-6b — deriveShelterCloseHousehold', () => {
	const hh = createHousehold({ label: 'ครอบครัว ก' }, ctx);

	it('sets checkout_destination shelter_closed when a household becomes checked_out', () => {
		const next = deriveShelterCloseHousehold({ ...hh, status: 'checked_in' }, [
			'checked_out',
			'checked_out'
		]);
		expect(next).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
	});

	it('keeps an existing checkout_destination', () => {
		const destination = { type: 'returned_home' as const };
		const next = deriveShelterCloseHousehold(
			{ ...hh, status: 'checked_in', checkout_destination: destination },
			['checked_out']
		);
		expect(next?.checkout_destination).toBe(destination);
	});

	it('all cancelled → cancelled, without a destination', () => {
		const next = deriveShelterCloseHousehold({ ...hh, status: 'pre_registered' }, [
			'cancelled',
			'cancelled'
		]);
		expect(next).toMatchObject({ status: 'cancelled', checkout_destination: null });
	});

	it('mixed cancelled + checked_out → checked_out', () => {
		const next = deriveShelterCloseHousehold({ ...hh, status: 'checked_in' }, [
			'cancelled',
			'checked_out'
		]);
		expect(next).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
	});

	it('returns null when nothing changes', () => {
		expect(
			deriveShelterCloseHousehold(
				{ ...hh, status: 'checked_out', checkout_destination: { type: 'shelter_closed' } },
				['checked_out']
			)
		).toBeNull();
	});
});

describe('CR-219 FR-25 — reopening restores nothing', () => {
	it('a person closed out by shelter_closed checks back in through the normal path', () => {
		const { evacuee } = buildShelterCloseCheckout(evacueeIn('active'), ctx, AT);
		const back = createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone: 'Z2' }, ctx);
		expect(applyMovementToStay(evacuee, back).current_stay).toMatchObject({
			status: 'active',
			zone: 'Z2'
		});
	});

	it('a cancelled pre-registration stays terminal', () => {
		const cancelled = buildShelterCloseCancel(evacueeIn('pre_registered'), AT);
		expect(() => assertMovementAllowed(cancelled, 'check_in')).toThrow(/ยกเลิก/);
	});
});

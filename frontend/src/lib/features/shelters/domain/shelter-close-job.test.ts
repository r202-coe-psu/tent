import { describe, expect, it } from 'vitest';
import {
	SHELTER_CLOSE_END_REASONS,
	describeShelterCloseJobOutcome,
	isShelterCloseJobActive,
	isShelterCloseJobActiveStatus,
	shelterCloseActiveJobSchema,
	shelterCloseJobStartedSchema,
	shelterCloseJobViewSchema,
	type ShelterCloseJobView
} from './shelter-close-job';
import { shelterCloseJobPhaseLabel, shelterCloseJobProgress } from './shelter-close-flow';

const counters = (over: Partial<ShelterCloseJobView['counters']> = {}) => ({
	checked_out: 0,
	cancelled: 0,
	households_repaired: 0,
	failed: 0,
	...over
});

describe('describeShelterCloseJobOutcome (FR-29)', () => {
	it('ok → success with X / Y', () => {
		expect(
			describeShelterCloseJobOutcome({
				status: 'completed',
				end_reason: 'ok',
				counters: counters({ checked_out: 12, cancelled: 3 })
			})
		).toEqual({ kind: 'success', message: 'ปิดศูนย์แล้ว · เช็คเอาต์ 12 คน · ยกเลิก 3 คน' });
	});

	it('failed → names the failed count, only when it is above zero', () => {
		const withFailures = describeShelterCloseJobOutcome({
			status: 'completed_with_errors',
			end_reason: 'failed',
			counters: counters({ failed: 4 })
		});
		expect(withFailures).toEqual({
			kind: 'error',
			message: 'ล้มเหลว 4 คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'
		});
		const none = describeShelterCloseJobOutcome({
			status: 'completed_with_errors',
			end_reason: 'failed',
			counters: counters({ failed: 0 })
		});
		expect(none.message).not.toContain('ล้มเหลว 0');
		expect(none.kind).toBe('error');
	});

	it.each([
		['stale', 'งานปิดศูนย์หยุดไปนาน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่'],
		['sweep_exhausted', 'ยังมีคนค้างหลังตรวจครบ 3 รอบ — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'],
		[
			'attempts_exhausted',
			'งานถูกรับต่อเกินจำนวนที่กำหนด — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อเริ่มใหม่'
		]
	] as const)('%s → the exact FR-29 copy, regardless of failed count', (end_reason, message) => {
		for (const failed of [0, 7]) {
			expect(
				describeShelterCloseJobOutcome({
					status: 'completed_with_errors',
					end_reason,
					counters: counters({ failed })
				})
			).toEqual({ kind: 'error', message });
		}
	});

	it('every end_reason has a non-empty message', () => {
		for (const end_reason of SHELTER_CLOSE_END_REASONS) {
			const out = describeShelterCloseJobOutcome({
				status: end_reason === 'ok' ? 'completed' : 'completed_with_errors',
				end_reason,
				counters: counters({ failed: 1 })
			});
			expect(out.message.length).toBeGreaterThan(5);
		}
	});
});

describe('active status helpers', () => {
	it('queued / running are active, terminal states and junk are not', () => {
		expect(isShelterCloseJobActiveStatus('queued')).toBe(true);
		expect(isShelterCloseJobActiveStatus('running')).toBe(true);
		expect(isShelterCloseJobActiveStatus('completed')).toBe(false);
		expect(isShelterCloseJobActiveStatus('completed_with_errors')).toBe(false);
		expect(isShelterCloseJobActiveStatus(undefined)).toBe(false);
		expect(isShelterCloseJobActive({ status: 'running' })).toBe(true);
		expect(isShelterCloseJobActive({ status: 'completed' })).toBe(false);
	});
});

describe('shelterCloseJobProgress (FR-27)', () => {
	const base = (
		done: Partial<ShelterCloseJobView['counters']>,
		total: number,
		status = 'running'
	) => ({
		status: status as ShelterCloseJobView['status'],
		counters: counters(done),
		preview: { by_status: {}, total }
	});

	it('is (checked out + cancelled) / preview total', () => {
		expect(shelterCloseJobProgress(base({ checked_out: 3, cancelled: 1 }, 10))).toEqual({
			done: 4,
			total: 10,
			percent: 40
		});
	});

	it('never shows 100 % before the job is completed (arrivals are outside the denominator)', () => {
		expect(shelterCloseJobProgress(base({ checked_out: 15 }, 10)).percent).toBe(99);
		expect(shelterCloseJobProgress(base({ checked_out: 10 }, 10)).percent).toBe(99);
	});

	it('is 100 % once completed and 0 % for an empty snapshot', () => {
		expect(shelterCloseJobProgress(base({ checked_out: 10 }, 10, 'completed')).percent).toBe(100);
		expect(shelterCloseJobProgress(base({}, 0)).percent).toBe(0);
	});
});

describe('shelterCloseJobPhaseLabel', () => {
	it('labels every phase', () => {
		for (const phase of ['people', 'households', 'sweep', 'finalize', 'done'] as const) {
			expect(shelterCloseJobPhaseLabel(phase)).toBeTruthy();
			expect(shelterCloseJobPhaseLabel(phase)).not.toBe(phase);
		}
	});
});

describe('API schemas', () => {
	const valid = {
		job_id: 'J1',
		shelter_code: 'SH001',
		mode: 'close',
		status: 'running',
		phase: 'people',
		sweep_round: 0,
		counters: counters(),
		preview: { by_status: { active: 2 }, total: 2 },
		failures: [],
		closed: false,
		created_at: 'a',
		updated_at: 'b'
	};

	it('accepts a well-formed view and optional end_reason / timestamps', () => {
		expect(shelterCloseJobViewSchema.safeParse(valid).success).toBe(true);
		expect(
			shelterCloseJobViewSchema.safeParse({
				...valid,
				end_reason: 'sweep_exhausted',
				started_at: 'c',
				finished_at: 'd'
			}).success
		).toBe(true);
	});

	it.each([
		{ status: 'cancelled' },
		{ phase: 'closing' },
		{ end_reason: 'because' },
		{ sweep_round: -1 },
		{ mode: 'x' },
		{ counters: { ...counters(), failed: -1 } }
	])('rejects %j', (over) => {
		expect(shelterCloseJobViewSchema.safeParse({ ...valid, ...over }).success).toBe(false);
	});

	it('202 body and active_job shapes', () => {
		expect(shelterCloseJobStartedSchema.safeParse({ job_id: 'J' }).success).toBe(true);
		expect(shelterCloseJobStartedSchema.safeParse({}).success).toBe(false);
		expect(shelterCloseActiveJobSchema.safeParse({ job_id: 'J', status: 'queued' }).success).toBe(
			true
		);
		expect(
			shelterCloseActiveJobSchema.safeParse({ job_id: 'J', status: 'completed' }).success
		).toBe(false);
	});
});

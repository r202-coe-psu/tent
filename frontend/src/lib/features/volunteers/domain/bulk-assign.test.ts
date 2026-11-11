import { describe, expect, it } from 'vitest';
import { planBulkAssign, skipReasonText, summarizeBulk } from './bulk-assign';
import { shiftDutyWindow } from './duty-window';
import type { JobShift } from './job.schema';
import type { ShiftAssignment } from './shift-assignment.schema';
import type { Volunteer } from './volunteer.schema';

const shift = (over: Partial<JobShift> = {}): JobShift => ({
	id: 'js-a',
	date: '2026-11-10',
	end_date: '2026-11-10',
	start_time: '08:00',
	end_time: '12:00',
	quota: 5,
	...over
});

const MORNING = shift({ id: 'js-morning' });
const AFTERNOON = shift({ id: 'js-afternoon', start_time: '13:00', end_time: '17:00' });
const OVERLAPS_MORNING = shift({ id: 'js-overlap', start_time: '10:00', end_time: '14:00' });

let seq = 0;
const volunteer = (name: string): Volunteer =>
	({
		_id: `volunteer:${++seq}`,
		type: 'volunteer',
		shelter_code: 'SH001',
		first_name: name,
		last_name: 'ทดสอบ',
		skills: [],
		status: 'active'
	}) as unknown as Volunteer;

const held = (v: Volunteer, s: JobShift, over: Partial<ShiftAssignment> = {}): ShiftAssignment =>
	({
		volunteer_id: v._id,
		job_id: 'job:1',
		shift_id: s.id,
		duty_window: shiftDutyWindow(s),
		status: 'assigned',
		...over
	}) as ShiftAssignment;

const jobsById = new Map([
	['job:1', { title: 'ทีมครัว', shifts: [MORNING, AFTERNOON, OVERLAPS_MORNING] }],
	['job:other', { title: 'งานอื่น', shifts: [] }]
]);

const plan = (over: Partial<Parameters<typeof planBulkAssign>[0]> = {}) =>
	planBulkAssign({
		job: { _id: 'job:1', skills_required: [] },
		shifts: [MORNING, AFTERNOON],
		volunteers: [],
		assignments: [],
		jobsById,
		...over
	});

describe('planBulkAssign (#1164)', () => {
	it('places one volunteer in several shifts', () => {
		const a = volunteer('ก');
		const { assign, skipped } = plan({ volunteers: [a] });
		expect(skipped).toEqual([]);
		expect(assign.map((i) => [i.shift.id, i.volunteer._id])).toEqual([
			['js-morning', a._id],
			['js-afternoon', a._id]
		]);
		expect(assign[0].dutyWindow).toEqual(shiftDutyWindow(MORNING));
	});

	it('places several volunteers in several shifts', () => {
		const [a, b] = [volunteer('ก'), volunteer('ข')];
		const { assign } = plan({ volunteers: [a, b] });
		expect(assign).toHaveLength(4);
	});

	it('skips a shift the volunteer is already on and still saves the others', () => {
		const a = volunteer('ก');
		const { assign, skipped } = plan({
			volunteers: [a],
			assignments: [held(a, MORNING)]
		});
		expect(assign.map((i) => i.shift.id)).toEqual(['js-afternoon']);
		expect(skipped).toMatchObject([
			{ shift: { id: 'js-morning' }, reason: { kind: 'already_on_shift' } }
		]);
	});

	it('skips a shift that clashes with another job, naming it', () => {
		const a = volunteer('ก');
		const other = shift({ id: 'js-other', start_time: '08:30', end_time: '09:30' });
		const { assign, skipped } = plan({
			volunteers: [a],
			assignments: [held(a, other, { job_id: 'job:other' })],
			jobsById: new Map([
				['job:1', { title: 'ทีมครัว', shifts: [MORNING, AFTERNOON] }],
				['job:other', { title: 'งานอื่น', shifts: [other] }]
			])
		});
		expect(assign.map((i) => i.shift.id)).toEqual(['js-afternoon']);
		expect(skipped[0].reason).toMatchObject({
			kind: 'clash',
			sameJob: false,
			jobTitle: 'งานอื่น',
			overlap: { start: '08:30', end: '09:30' }
		});
	});

	it('does not put one person in two shifts of this job that overlap each other', () => {
		const a = volunteer('ก');
		const { assign, skipped } = plan({
			shifts: [MORNING, OVERLAPS_MORNING],
			volunteers: [a]
		});
		expect(assign.map((i) => i.shift.id)).toEqual(['js-morning']);
		expect(skipped).toMatchObject([
			{
				shift: { id: 'js-overlap' },
				reason: {
					kind: 'clash',
					sameJob: true,
					jobTitle: 'ทีมครัว',
					overlap: { start: '10:00', end: '12:00' }
				}
			}
		]);
	});

	it("runs out a shift's seats as it fills, in the order given", () => {
		const [a, b, c] = [volunteer('ก'), volunteer('ข'), volunteer('ค')];
		const tight = shift({ id: 'js-tight', quota: 2 });
		const { assign, skipped } = plan({ shifts: [tight], volunteers: [a, b, c] });
		expect(assign.map((i) => i.volunteer._id)).toEqual([a._id, b._id]);
		expect(skipped).toMatchObject([{ volunteer: { _id: c._id }, reason: { kind: 'shift_full' } }]);
	});

	it('counts seats already held when it decides a shift is full', () => {
		const [a, b] = [volunteer('ก'), volunteer('ข')];
		const tight = shift({ id: 'js-tight', quota: 1 });
		const { assign, skipped } = plan({
			shifts: [tight],
			volunteers: [b],
			assignments: [held(a, tight)]
		});
		expect(assign).toEqual([]);
		expect(skipped[0].reason).toEqual({ kind: 'shift_full' });
	});

	it('skips every volunteer of a shift with a malformed time and carries on', () => {
		const a = volunteer('ก');
		const broken = shift({ id: 'js-broken', start_time: 'xx' });
		const { assign, skipped } = plan({ shifts: [broken, AFTERNOON], volunteers: [a] });
		expect(assign.map((i) => i.shift.id)).toEqual(['js-afternoon']);
		expect(skipped[0].reason.kind).toBe('bad_shift_time');
	});

	it('says where two shifts overlap, and leaves it out for a shift past midnight (W7)', () => {
		const a = volunteer('ก');
		const overnight = shift({
			id: 'js-night',
			start_time: '22:00',
			end_time: '06:00',
			end_date: '2026-11-11'
		});
		const [clash] = plan({ shifts: [MORNING, OVERLAPS_MORNING], volunteers: [a] }).skipped;
		expect(clash.reason).toMatchObject({
			kind: 'clash',
			overlap: { start: '10:00', end: '12:00' }
		});

		const evening = shift({
			id: 'js-evening',
			date: '2026-11-10',
			start_time: '21:00',
			end_time: '23:00'
		});
		const [night] = plan({
			shifts: [overnight],
			volunteers: [a],
			assignments: [held(a, evening, { job_id: 'job:other' })],
			jobsById: new Map([['job:other', { title: 'งานอื่น', shifts: [evening] }]])
		}).skipped;
		expect(night.reason).toEqual({
			kind: 'clash',
			sameJob: false,
			jobTitle: 'งานอื่น',
			startTime: '21:00',
			endTime: '23:00',
			overlap: null
		});
	});

	it('words each reason in plain Thai', () => {
		expect(skipReasonText({ kind: 'already_on_shift' })).toBe('อยู่ในกะนี้อยู่แล้ว');
		expect(skipReasonText({ kind: 'shift_full' })).toBe('กะนี้เต็มแล้ว');
		const clash = {
			kind: 'clash' as const,
			jobTitle: 'ทีมครัว',
			startTime: '08:00',
			endTime: '12:00'
		};
		expect(
			skipReasonText({ ...clash, sameJob: true, overlap: { start: '10:00', end: '12:00' } })
		).toBe('ชนกับกะ 08:00-12:00 น. ของงานนี้ที่เขาอยู่แล้ว ซ้อนกันช่วง 10:00-12:00 น.');
		expect(skipReasonText({ ...clash, sameJob: false, overlap: null })).toBe(
			'ชนกับกะ 08:00-12:00 น. ของงาน "ทีมครัว" ที่เขาอยู่แล้ว'
		);
	});
});

describe('summarizeBulk (#1164)', () => {
	it('lists, per person in the order chosen, the shifts placed and those not, with reasons and shiftId keys', () => {
		const [a, b] = [volunteer('ก'), volunteer('ข')];
		const summary = summarizeBulk(
			[a, b],
			[
				{ shift: MORNING, volunteer: b, ok: true },
				{ shift: MORNING, volunteer: a, ok: true },
				{ shift: AFTERNOON, volunteer: a, ok: false, why: 'กะนี้เต็มแล้ว' }
			]
		);
		expect(summary.placedCount).toBe(2);
		expect(summary.notPlacedCount).toBe(1);
		expect(summary.people.map((p) => p.name)).toEqual(['ก ทดสอบ', 'ข ทดสอบ']);
		expect(summary.people[0]).toMatchObject({
			placed: [{ shiftId: 'js-morning', shift: '2026-11-10 08:00-12:00 น.' }],
			notPlaced: [
				{ shiftId: 'js-afternoon', shift: '2026-11-10 13:00-17:00 น.', why: 'กะนี้เต็มแล้ว' }
			]
		});
		expect(summary.people[1]).toMatchObject({
			placed: [{ shiftId: 'js-morning', shift: '2026-11-10 08:00-12:00 น.' }],
			notPlaced: []
		});
	});

	it('provides unique shiftId keys even when multiple shifts have identical times (W1)', () => {
		const a = volunteer('ก');
		const shift1 = shift({ id: 'js-dup-1', start_time: '08:00', end_time: '12:00' });
		const shift2 = shift({ id: 'js-dup-2', start_time: '08:00', end_time: '12:00' });
		const summary = summarizeBulk(
			[a],
			[
				{ shift: shift1, volunteer: a, ok: false, why: 'กะนี้เต็มแล้ว' },
				{ shift: shift2, volunteer: a, ok: false, why: 'กะนี้เต็มแล้ว' }
			]
		);
		expect(summary.people[0].notPlaced).toEqual([
			{ shiftId: 'js-dup-1', shift: '2026-11-10 08:00-12:00 น.', why: 'กะนี้เต็มแล้ว' },
			{ shiftId: 'js-dup-2', shift: '2026-11-10 08:00-12:00 น.', why: 'กะนี้เต็มแล้ว' }
		]);
		const keys = summary.people[0].notPlaced.map((item) => item.shiftId);
		expect(new Set(keys).size).toBe(2);
	});

	it('displays end_date in shift text when shift spans across midnight (Nitpicks)', () => {
		const a = volunteer('ก');
		const overnight = shift({
			id: 'js-night',
			date: '2026-11-10',
			start_time: '22:00',
			end_time: '06:00',
			end_date: '2026-11-11'
		});
		const summary = summarizeBulk([a], [{ shift: overnight, volunteer: a, ok: true }]);
		expect(summary.people[0].placed[0]).toEqual({
			shiftId: 'js-night',
			shift: '2026-11-10 22:00 - 2026-11-11 06:00 น.'
		});
	});

	it('keeps a person with nothing placed, so they are not silently missing', () => {
		const a = volunteer('ก');
		const summary = summarizeBulk(
			[a],
			[{ shift: MORNING, volunteer: a, ok: false, why: 'อยู่ในกะนี้อยู่แล้ว' }]
		);
		expect(summary.people).toHaveLength(1);
		expect(summary.people[0].placed).toEqual([]);
		expect(summary.placedCount).toBe(0);
	});
});

import { describe, expect, it } from 'vitest';
import { summarizeUrgentVolunteerNeed } from './urgent-need';
import type { PublicJob } from './volunteer';

function job(overrides: Partial<PublicJob> & { job_id: string }): PublicJob {
	return {
		shelter_code: 'SH001',
		shelter_name: 'ศูนย์ ม.อ.',
		title: 'งานครัว',
		description: '',
		tier: 'operational',
		skills_required: [],
		shift_template: { shift_name: '', start_time: '', end_time: '', days: [] },
		quota: 10,
		slots_confirmed: 4,
		slots_remaining: 6,
		status: 'open',
		requires_review: false,
		is_urgent: true,
		...overrides
	};
}

describe('summarizeUrgentVolunteerNeed', () => {
	it('adds up what open urgent jobs still need and already have', () => {
		const summary = summarizeUrgentVolunteerNeed([
			job({ job_id: 'a', slots_remaining: 6, slots_confirmed: 4 }),
			job({ job_id: 'b', slots_remaining: 2, slots_confirmed: 3 })
		]);
		expect(summary.needed).toBe(8);
		expect(summary.enrolled).toBe(7);
	});

	it('leaves out jobs that are not urgent, not open, or from projections without the flag', () => {
		const summary = summarizeUrgentVolunteerNeed([
			job({ job_id: 'ordinary', is_urgent: false }),
			job({ job_id: 'old-projection', is_urgent: undefined }),
			job({ job_id: 'paused', status: 'paused' }),
			job({ job_id: 'counted', slots_remaining: 1, slots_confirmed: 2 })
		]);
		expect(summary).toMatchObject({ needed: 1, enrolled: 2 });
	});

	it('treats a missing counter from an older projection as zero, never NaN', () => {
		const partial = job({ job_id: 'old' }) as Partial<PublicJob> & { job_id: string };
		delete partial.slots_confirmed;
		delete partial.quota;
		const summary = summarizeUrgentVolunteerNeed([partial as PublicJob]);
		expect(summary).toMatchObject({ needed: 6, enrolled: 0 });
		expect(summary.shelters[0]).toMatchObject({ needed: 6, enrolled: 0, quota: 0 });
	});

	it('is zero with nothing urgent', () => {
		expect(summarizeUrgentVolunteerNeed([])).toEqual({ needed: 0, enrolled: 0, shelters: [] });
	});

	it('groups cards by shelter, most short-handed first, and skips jobs with no room left', () => {
		const summary = summarizeUrgentVolunteerNeed([
			job({ job_id: 'a1', title: 'ครัว', slots_remaining: 2 }),
			job({ job_id: 'a2', title: 'คัดแยกของ', slots_remaining: 5 }),
			job({
				job_id: 'b1',
				shelter_code: 'SH002',
				shelter_name: 'ศูนย์หาดใหญ่',
				title: 'ขนของ',
				slots_remaining: 9
			}),
			job({ job_id: 'full', shelter_code: 'SH003', slots_remaining: 0, slots_confirmed: 10 })
		]);
		expect(summary.shelters.map((s) => s.shelter_code)).toEqual(['SH002', 'SH001']);
		expect(summary.shelters[1]).toMatchObject({
			job_titles: ['คัดแยกของ', 'ครัว'],
			needed: 7,
			enrolled: 8,
			quota: 20
		});
		// A full urgent job still counts its people as "มีแล้ว".
		expect(summary.enrolled).toBe(4 * 3 + 10);
	});
	describe('shifts that have ended (#972)', () => {
		const now = new Date('2026-10-28T20:00:00+07:00');
		const shift = (id: string, date: string, remaining: number, confirmed: number) => ({
			shift_id: id,
			date,
			end_date: date,
			start_time: '08:00',
			end_time: '16:00',
			station: null,
			quota: remaining + confirmed,
			slots_confirmed: confirmed,
			slots_remaining: remaining
		});

		it('counts only the shifts still open', () => {
			const summary = summarizeUrgentVolunteerNeed(
				[
					job({
						job_id: 'mixed',
						shifts: [shift('past', '2026-10-27', 5, 1), shift('next', '2026-10-29', 3, 2)]
					})
				],
				now
			);
			expect(summary).toMatchObject({ needed: 3, enrolled: 2 });
			expect(summary.shelters[0]).toMatchObject({ needed: 3, enrolled: 2, quota: 5 });
		});

		it('keeps a job that needs people in an open shift although the ended one is over-booked', () => {
			// Job-level slots_remaining is 0 (2 + 2 - 5 booked is clamped), yet the open shift needs 2.
			const summary = summarizeUrgentVolunteerNeed(
				[
					job({
						job_id: 'overbooked-past',
						quota: 4,
						slots_confirmed: 5,
						slots_remaining: 0,
						shifts: [shift('past', '2026-10-27', 0, 5), shift('next', '2026-10-29', 2, 0)]
					})
				],
				now
			);
			expect(summary).toMatchObject({ needed: 2, enrolled: 0 });
			expect(summary.shelters).toHaveLength(1);
		});

		it('drops a job whose only free seats are in an ended shift', () => {
			const summary = summarizeUrgentVolunteerNeed(
				[
					job({
						job_id: 'free-past',
						slots_remaining: 4,
						shifts: [shift('past', '2026-10-27', 4, 0), shift('next', '2026-10-29', 0, 2)]
					})
				],
				now
			);
			expect(summary).toMatchObject({ needed: 0, shelters: [] });
		});

		it('drops a job whose shifts have all ended', () => {
			const summary = summarizeUrgentVolunteerNeed(
				[job({ job_id: 'over', shifts: [shift('past', '2026-10-27', 5, 1)] })],
				now
			);
			expect(summary).toEqual({ needed: 0, enrolled: 0, shelters: [] });
		});
	});
});

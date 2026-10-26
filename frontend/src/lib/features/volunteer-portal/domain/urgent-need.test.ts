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
});

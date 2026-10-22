import type { PublicJob } from './volunteer';

/** One shelter's urgent jobs that still need people — one card on the home page. */
export type UrgentShelterNeed = {
	shelter_code: string;
	shelter_name: string;
	/** The urgent jobs' titles, the most short-handed first. */
	job_titles: string[];
	needed: number;
	enrolled: number;
	quota: number;
};

export type UrgentVolunteerNeed = {
	/** People still wanted across every open urgent job. */
	needed: number;
	/** People already confirmed on those same jobs. */
	enrolled: number;
	/** Shelters with an urgent job that still has room, the most short-handed first. */
	shelters: UrgentShelterNeed[];
};

/**
 * The public home page's volunteer figures (#709): "ต้องการอีก n คน (มีแล้ว m คน)" and the
 * urgent-job cards under it.
 *
 * Counts only jobs staff flagged urgent (`is_urgent`) that are still open — the card says
 * "งานอาสาสมัครเร่งด่วน", so an ordinary posting must not inflate it.
 */
export function summarizeUrgentVolunteerNeed(jobs: readonly PublicJob[]): UrgentVolunteerNeed {
	const urgent = jobs.filter((job) => job.is_urgent === true && job.status === 'open');
	const byShelter = new Map<string, UrgentShelterNeed & { jobs: PublicJob[] }>();
	for (const job of urgent) {
		if ((job.slots_remaining ?? 0) <= 0) continue;
		const entry = byShelter.get(job.shelter_code) ?? {
			shelter_code: job.shelter_code,
			shelter_name: job.shelter_name || job.shelter_code,
			job_titles: [],
			needed: 0,
			enrolled: 0,
			quota: 0,
			jobs: []
		};
		entry.jobs.push(job);
		// `?? 0`: an older projection row may lack a counter; one gap must not make the card NaN.
		entry.needed += job.slots_remaining ?? 0;
		entry.enrolled += job.slots_confirmed ?? 0;
		entry.quota += job.quota ?? 0;
		byShelter.set(job.shelter_code, entry);
	}
	const shelters = [...byShelter.values()]
		.map(({ jobs: shelterJobs, ...entry }) => ({
			...entry,
			job_titles: [...shelterJobs]
				.sort((a, b) => b.slots_remaining - a.slots_remaining)
				.map((job) => job.title)
		}))
		.sort((a, b) => b.needed - a.needed);
	return {
		needed: urgent.reduce((sum, job) => sum + Math.max(job.slots_remaining ?? 0, 0), 0),
		enrolled: urgent.reduce((sum, job) => sum + Math.max(job.slots_confirmed ?? 0, 0), 0),
		shelters
	};
}

// Deep import: the volunteers barrel re-exports UI that imports the portal domain (cycle).
import { hasOpenShift, openShifts } from '$lib/features/volunteers/domain/shift-closing';
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
 * What a job still needs, counted over its shifts that have not ended (#972). A job with no
 * shift rows keeps its own counters. Either way `?? 0`: an older projection row may lack a
 * counter, and one gap must not make the card NaN.
 */
function openFigures(job: PublicJob, now: Date) {
	const shifts = job.shifts ?? [];
	if (shifts.length === 0) {
		return {
			needed: job.slots_remaining ?? 0,
			enrolled: Math.max(job.slots_confirmed ?? 0, 0),
			quota: job.quota ?? 0
		};
	}
	const open = openShifts(shifts, now);
	return {
		needed: open.reduce((sum, s) => sum + Math.max(s.slots_remaining ?? 0, 0), 0),
		enrolled: open.reduce((sum, s) => sum + Math.max(s.slots_confirmed ?? 0, 0), 0),
		quota: open.reduce((sum, s) => sum + (s.quota ?? 0), 0)
	};
}

/**
 * The public home page's volunteer figures (#709): "ต้องการอีก n คน (มีแล้ว m คน)" and the
 * urgent-job cards under it.
 *
 * Counts only jobs staff flagged urgent (`is_urgent`) that are still open — the card says
 * "งานอาสาสมัครเร่งด่วน", so an ordinary posting must not inflate it. Shifts that have
 * already ended count for nothing, and a job whose shifts have all ended drops out (#972).
 */
export function summarizeUrgentVolunteerNeed(
	jobs: readonly PublicJob[],
	now: Date = new Date()
): UrgentVolunteerNeed {
	const urgent = jobs
		.filter((job) => job.is_urgent === true && job.status === 'open' && hasOpenShift(job, now))
		.map((job) => ({ job, figures: openFigures(job, now) }));
	const byShelter = new Map<
		string,
		UrgentShelterNeed & { jobs: { job: PublicJob; needed: number }[] }
	>();
	for (const { job, figures } of urgent) {
		if (figures.needed <= 0) continue;
		const entry = byShelter.get(job.shelter_code) ?? {
			shelter_code: job.shelter_code,
			shelter_name: job.shelter_name || job.shelter_code,
			job_titles: [],
			needed: 0,
			enrolled: 0,
			quota: 0,
			jobs: []
		};
		entry.jobs.push({ job, needed: figures.needed });
		entry.needed += figures.needed;
		entry.enrolled += figures.enrolled;
		entry.quota += figures.quota;
		byShelter.set(job.shelter_code, entry);
	}
	const shelters = [...byShelter.values()]
		.map(({ jobs: shelterJobs, ...entry }) => ({
			...entry,
			job_titles: [...shelterJobs].sort((a, b) => b.needed - a.needed).map(({ job }) => job.title)
		}))
		.sort((a, b) => b.needed - a.needed);
	return {
		needed: urgent.reduce((sum, { figures }) => sum + Math.max(figures.needed, 0), 0),
		enrolled: urgent.reduce((sum, { figures }) => sum + Math.max(figures.enrolled, 0), 0),
		shelters
	};
}

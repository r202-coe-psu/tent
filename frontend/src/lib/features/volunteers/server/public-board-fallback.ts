/**
 * The public job board's CouchDB fallback (used only while FastAPI is unreachable or failing):
 * the same filters, order and shelter list FastAPI computes in Mongo (CR-265
 * FR-2/3/5/6, CR-215 FR-4), applied to jobs already held in memory so the
 * response matches either way (#1470 review W3).
 *
 * Server-only and pure: no I/O, no Svelte. Routes import it by path, not through the barrel,
 * which pulls UI into the SSR graph.
 */
import { hasOpenShift } from '../domain/shift-closing';
import { DEFAULT_CONTROLLED_SKILLS } from '../domain/skills';

export type BoardStatus = 'open' | 'near_full' | 'controlled';

export interface FallbackShift {
	date?: string;
	end_date?: string | null;
	start_time?: string;
	end_time?: string;
	slots_remaining?: number;
}

export interface FallbackJob {
	_id: string;
	title?: string;
	shelter_code?: string;
	tier?: string;
	skills_required?: string[];
	slots_remaining?: number;
	shifts?: FallbackShift[];
}

export interface FallbackShelter {
	code: string;
	name: string;
	db: string;
}

export interface MasterSkillItemLike {
	code: string;
	label_th?: string;
	label_en?: string;
	category?: string;
	status?: string;
}

const norm = (value: string | undefined | null): string => (value ?? '').trim().toLowerCase();

/**
 * Controlled-skill values (code and both labels, lower-cased) from the global Master Data
 * list, like FastAPI `controlled_skills()`; the built-in floor when Master Data has none.
 */
export function controlledValuesFromMaster(items: readonly MasterSkillItemLike[]): Set<string> {
	const values = new Set<string>();
	for (const item of items) {
		if (norm(item.category) !== 'controlled' || item.status === 'inactive') continue;
		for (const value of [item.code, item.label_th, item.label_en]) {
			if (norm(value)) values.add(norm(value));
		}
	}
	if (values.size > 0) return values;
	return new Set(DEFAULT_CONTROLLED_SKILLS.map(norm).filter(Boolean));
}

function remainingOf(job: FallbackJob): number[] {
	return job.shifts && job.shifts.length > 0
		? job.shifts.map((shift) => shift.slots_remaining ?? 0)
		: [job.slots_remaining ?? 0];
}

function isOpen(job: FallbackJob, now: Date): boolean {
	return hasOpenShift(
		{
			shifts: (job.shifts ?? []).map((shift) => ({
				date: shift.date ?? '',
				end_date: shift.end_date ?? null,
				start_time: shift.start_time ?? null,
				end_time: shift.end_time ?? null
			}))
		},
		now
	);
}

const byText = (a: string | undefined, b: string | undefined): number =>
	(a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0;

export function filterFallbackJobs(
	jobs: readonly FallbackJob[],
	opts: {
		q: string;
		status?: BoardStatus;
		skills: readonly string[];
		page?: number;
		pageSize?: number;
		/** shelter code (upper case) → name, for `q` (FastAPI matches the shelter name too). */
		shelterNames: ReadonlyMap<string, string>;
		/** lower-cased controlled-skill values ({@link controlledValuesFromMaster}). */
		controlled: ReadonlySet<string>;
		now?: Date;
	}
): { jobs: FallbackJob[]; total: number } {
	const now = opts.now ?? new Date();
	const q = norm(opts.q);
	const wanted = new Set(opts.skills);
	const filtered = jobs.filter((job) => {
		if (q) {
			const code = (job.shelter_code ?? '').toUpperCase();
			const hit =
				norm(job.title).includes(q) ||
				norm(code).includes(q) ||
				norm(opts.shelterNames.get(code)).includes(q) ||
				(job.skills_required ?? []).some((skill) => norm(skill).includes(q));
			if (!hit) return false;
		}
		if (wanted.size > 0 && !(job.skills_required ?? []).some((skill) => wanted.has(skill))) {
			return false;
		}
		if (opts.status === 'open') return remainingOf(job).some((r) => r >= 1);
		if (opts.status === 'near_full') return remainingOf(job).some((r) => r >= 1 && r <= 2);
		if (opts.status === 'controlled') {
			return (
				job.tier === 'staff-capable' ||
				(job.skills_required ?? []).some((skill) => opts.controlled.has(norm(skill)))
			);
		}
		return true;
	});

	// FastAPI order (FR-5) with ended jobs after every open one (CR-215 FR-4), then the page.
	const sorted = filtered
		.map((job) => ({ job, closed: isOpen(job, now) ? 0 : 1 }))
		.sort(
			(a, b) =>
				a.closed - b.closed ||
				byText(a.job.shelter_code, b.job.shelter_code) ||
				byText(a.job.title, b.job.title) ||
				byText(a.job._id, b.job._id)
		)
		.map(({ job }) => job);

	if (!opts.pageSize) return { jobs: sorted, total: sorted.length };
	const start = ((opts.page ?? 1) - 1) * opts.pageSize;
	return { jobs: sorted.slice(start, start + opts.pageSize), total: sorted.length };
}

/** Shelters that have a board job, by code — the picker list, independent of the filters (FR-6). */
export function boardShelters(
	shelters: readonly FallbackShelter[],
	jobs: readonly FallbackJob[]
): { code: string; name: string }[] {
	const withJobs = new Set(jobs.map((job) => (job.shelter_code ?? '').toUpperCase()));
	return shelters
		.filter((shelter) => withJobs.has(shelter.code.toUpperCase()))
		.map(({ code, name }) => ({ code, name }))
		.sort((a, b) => byText(a.code, b.code));
}

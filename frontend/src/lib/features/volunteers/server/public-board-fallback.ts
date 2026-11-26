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
	/** Couch job docs keep only `quota` on a shift until someone applies (#1470 review B1). */
	quota?: number;
	slots_confirmed?: number;
	confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
}

export interface FallbackJob {
	_id: string;
	title?: string;
	shelter_code?: string;
	tier?: string;
	skills_required?: string[];
	quota?: number;
	slots_confirmed?: number;
	slots_dispatched?: number;
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
	label?: string;
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
		for (const value of [item.code, item.label, item.label_th, item.label_en]) {
			if (norm(value)) values.add(norm(value));
		}
	}
	if (values.size > 0) return values;
	return new Set(DEFAULT_CONTROLLED_SKILLS.map(norm).filter(Boolean));
}

/** Codes of skills whose code or display name contains `text` (CR-265 D3), like FastAPI. */
export function skillCodesByLabel(
	items: readonly MasterSkillItemLike[],
	text: string
): Set<string> {
	const needle = norm(text);
	const codes = new Set<string>();
	if (!needle) return codes;
	for (const item of items) {
		if (item.status === 'inactive' || !item.code) continue;
		if ([item.label_th, item.label_en, item.label].some((n) => norm(n).includes(needle))) {
			codes.add(item.code);
		}
	}
	return codes;
}

/** Same derivation as the worker projector and `public-application.ts`: quota − confirmed − dispatched. */
function remainingFrom(row: {
	quota?: number;
	slots_confirmed?: number;
	confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
}): number {
	return (
		row.slots_remaining ??
		Math.max(
			(row.quota ?? 0) - (row.slots_confirmed ?? row.confirmed ?? 0) - (row.slots_dispatched ?? 0),
			0
		)
	);
}

/** Remaining seats per shift still open at `now` (CR-265 FR-3: ended shifts never count). */
function remainingOf(job: FallbackJob, now: Date): number[] {
	if (job.shifts && job.shifts.length > 0) {
		return job.shifts
			.filter((shift) => isOpen({ _id: job._id, shifts: [shift] }, now))
			.map(remainingFrom);
	}
	return [remainingFrom(job)];
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
		/** Skill codes whose display name matches `q` ({@link skillCodesByLabel}, CR-265 D3). */
		skillCodesByLabel?: ReadonlySet<string>;
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
				(job.skills_required ?? []).some(
					(skill) => norm(skill).includes(q) || opts.skillCodesByLabel?.has(skill)
				);
			if (!hit) return false;
		}
		if (wanted.size > 0 && !(job.skills_required ?? []).some((skill) => wanted.has(skill))) {
			return false;
		}
		if (opts.status === 'open') return remainingOf(job, now).some((r) => r >= 1);
		if (opts.status === 'near_full') return remainingOf(job, now).some((r) => r >= 1 && r <= 2);
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

/** Board-wide counts that ignore every filter and page (CR-265 FR-9/10/11), like FastAPI. */
export function summarizeFallbackJobs(
	jobs: readonly FallbackJob[],
	controlled: ReadonlySet<string>,
	now: Date = new Date()
): { total: number; open: number; near_full: number; controlled: number } {
	let open = 0;
	let nearFull = 0;
	let controlledCount = 0;
	for (const job of jobs) {
		const remaining = remainingOf(job, now);
		if (remaining.some((r) => r >= 1)) open += 1;
		if (remaining.some((r) => r >= 1 && r <= 2)) nearFull += 1;
		if (
			job.tier === 'staff-capable' ||
			(job.skills_required ?? []).some((skill) => controlled.has(norm(skill)))
		) {
			controlledCount += 1;
		}
	}
	return { total: jobs.length, open, near_full: nearFull, controlled: controlledCount };
}

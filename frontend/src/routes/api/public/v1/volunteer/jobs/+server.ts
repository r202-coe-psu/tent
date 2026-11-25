import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { readMasterDoc } from '$lib/server/master-data-server';
import { loadCouchBoard } from '$lib/features/volunteers/server/public-board-couch';
import { toPublicBoardItem } from '$lib/features/volunteers/server/public-board-item';
import {
	boardShelters,
	controlledValuesFromMaster,
	filterFallbackJobs,
	skillCodesByLabel
} from '$lib/features/volunteers/server/public-board-fallback';

export const prerender = false;

interface JobDoc {
	_id: string;
	job_id?: string;
	type: string;
	title: string;
	description?: string;
	status?: string;
	shelter_code?: string;
	tier?: string;
	skills_required?: string[];
	shifts?: Array<{
		id?: string;
		shift_id?: string;
		date?: string;
		start_time?: string;
		end_time?: string;
		quota?: number;
		slots_confirmed?: number;
		slots_remaining?: number;
		applicants_count?: number;
		confirmed?: number;
	}>;
	quota?: number;
	slots_confirmed?: number;
	slots_remaining?: number;
	applicants_count?: number;
	is_urgent?: boolean;
}

/**
 * Keep the public board's displayed counts derived from the job projection only.
 * Do not scan `job_application` documents here: those rows contain applicant PII,
 * and the public board only needs the already-projected quota counters.
 */
function enrichJobsWithQuotaCounts(jobs: JobDoc[]): void {
	for (const job of jobs) {
		let shiftAppsSum = 0;

		if (job.shifts && Array.isArray(job.shifts)) {
			for (const shift of job.shifts) {
				const confirmed = shift.slots_confirmed ?? shift.confirmed ?? 0;
				shift.applicants_count = Math.max(shift.applicants_count || 0, confirmed);
				shiftAppsSum += shift.applicants_count;
			}
		}

		job.applicants_count = Math.max(
			job.applicants_count || 0,
			job.slots_confirmed || 0,
			shiftAppsSum
		);
	}
}

const BOARD_STATUSES = ['open', 'near_full', 'controlled'] as const;
const MAX_PAGE_SIZE = 50;
/** More skill values than any filter UI sends (code + both labels per picked skill). */
const MAX_SKILLS = 20;
/** Same bound as FastAPI (`le=` on `page`): far past any real board, so a huge value is refused. */
const MAX_PAGE = 1000;

/** Positive safe integer from a query value, or undefined when absent or malformed. */
function positiveInt(value: string | null): number | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const n = Number(value);
	return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

/** A digits-only `page` too large to serve: refused rather than silently dropped. */
function pageOutOfRange(value: string | null): boolean {
	if (!value || !/^\d+$/.test(value)) return false;
	const n = Number(value);
	return !Number.isSafeInteger(n) || n > MAX_PAGE;
}

/**
 * กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1) — the read half of the public board.
 * Only whitelisted filters are forwarded to FastAPI; anything else is dropped.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const query = new URLSearchParams();
	const shelterCode = url.searchParams.get('shelter_code') || url.searchParams.get('shelter');
	const skills = url.searchParams.getAll('skill').filter(Boolean).slice(0, MAX_SKILLS);
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const statusParam = url.searchParams.get('status');
	const status = BOARD_STATUSES.find((value) => value === statusParam);
	const pageParam = url.searchParams.get('page');
	// B2: an unbounded page reached FastAPI as "1e+21", got a 422 and sent the request into the
	// admin CouchDB scan below. Refuse it here, before any upstream call.
	if (pageOutOfRange(pageParam)) {
		return json({ success: false, error: 'invalid_page' }, { status: 400 });
	}
	const page = positiveInt(pageParam);
	// S2: a digits-only `page_size` past MAX_SAFE_INTEGER is capped, not dropped (dropping it
	// would serve the whole board unpaged).
	const pageSizeParam = url.searchParams.get('page_size');
	const pageSize =
		pageSizeParam && /^\d+$/.test(pageSizeParam) && Number(pageSizeParam) >= 1
			? Math.min(positiveInt(pageSizeParam) ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)
			: undefined;
	if (shelterCode) query.set('shelter_code', shelterCode);
	for (const skill of skills) query.append('skill', skill);
	if (q) query.set('q', q);
	if (status) query.set('status', status);
	if (page) query.set('page', String(page));
	if (pageSize) query.set('page_size', String(pageSize));
	const suffix = query.size > 0 ? `?${query}` : '';

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/jobs${suffix}`, {
			headers: fastapiServiceHeaders()
		});
		if (res.ok) {
			const body = await res.json();
			if (Array.isArray(body?.jobs) && body.jobs.length > 0) {
				enrichJobsWithQuotaCounts(body.jobs as JobDoc[]);
			}
			return json(body, { headers: { 'Cache-Control': 'no-store' } });
		}
		// Any 4xx is FastAPI's answer to this request: pass it on. Only an unreachable or failing
		// (5xx) FastAPI falls back to CouchDB, so a bad query can never trigger the admin scan.
		if (res.status >= 400 && res.status < 500) {
			const body = await res.json().catch(() => ({ success: false }));
			return json(body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
		}
	} catch {
		// Fall through to CouchDB fallback if FastAPI is offline
	}

	try {
		const { shelters, jobs } = await loadCouchBoard<JobDoc>();

		const wantedShelter = shelterCode?.toUpperCase();
		const inShelter = wantedShelter
			? jobs.filter((job) => (job.shelter_code ?? '').toUpperCase() === wantedShelter)
			: jobs;
		const master = await readMasterDoc('volunteer_skills').catch(() => null);
		const result = filterFallbackJobs(inShelter, {
			q,
			status,
			skills,
			page,
			pageSize,
			shelterNames: new Map(shelters.map((s) => [s.code.toUpperCase(), s.name])),
			controlled: controlledValuesFromMaster(master?.items ?? []),
			skillCodesByLabel: skillCodesByLabel(master?.items ?? [], q)
		});
		const pageJobs = result.jobs as JobDoc[];
		enrichJobsWithQuotaCounts(pageJobs);
		const shelterNames = new Map(shelters.map((s) => [s.code.toUpperCase(), s.name]));

		return json(
			{
				success: true,
				// Only the card's own fields — never the CouchDB document (W-2).
				jobs: pageJobs.map((job) => toPublicBoardItem(job, shelterNames)),
				total: result.total,
				shelters: boardShelters(shelters, jobs)
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (err) {
		console.warn('Failed to load public volunteer jobs:', err);
		return json({ success: false, jobs: [], shelters: [] }, { status: 503 });
	}
};

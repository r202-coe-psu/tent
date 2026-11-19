import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { adminRaw } from '$lib/server/couch-admin';

export const prerender = false;

interface CouchAllDocsRow<T = Record<string, unknown>> {
	id: string;
	key: string;
	value: { rev: string };
	doc?: T;
}

interface CouchAllDocsResponse<T = Record<string, unknown>> {
	total_rows: number;
	offset: number;
	rows: CouchAllDocsRow<T>[];
}

interface ShelterRegistryDoc {
	_id: string;
	type: string;
	code?: string;
	name?: string;
	db?: string;
}

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
type BoardStatus = (typeof BOARD_STATUSES)[number];
const MAX_PAGE_SIZE = 50;

/** Positive integer from a query value, or undefined when absent or malformed. */
function positiveInt(value: string | null): number | undefined {
	if (!value || !/^\d+$/.test(value)) return undefined;
	const n = Number(value);
	return n >= 1 ? n : undefined;
}

/**
 * Same filters FastAPI applies in Mongo, for the CouchDB fallback only: it already holds
 * every job in memory, so narrowing and slicing here keeps the response shape identical.
 */
function filterFallbackJobs(
	jobs: JobDoc[],
	opts: {
		q: string;
		status?: BoardStatus;
		skills: string[];
		page?: number;
		pageSize?: number;
	}
): { jobs: JobDoc[]; total: number } {
	const remainingOf = (job: JobDoc): number[] =>
		job.shifts && job.shifts.length > 0
			? job.shifts.map((s) => s.slots_remaining ?? 0)
			: [job.slots_remaining ?? 0];
	const q = opts.q.toLowerCase();
	const wanted = new Set(opts.skills);
	const filtered = jobs.filter((job) => {
		if (q) {
			const hit =
				(job.title ?? '').toLowerCase().includes(q) ||
				(job.shelter_code ?? '').toLowerCase().includes(q) ||
				(job.skills_required ?? []).some((sk) => sk.toLowerCase().includes(q));
			if (!hit) return false;
		}
		if (wanted.size > 0 && !(job.skills_required ?? []).some((sk) => wanted.has(sk))) return false;
		if (opts.status === 'open') return remainingOf(job).some((r) => r >= 1);
		if (opts.status === 'near_full') return remainingOf(job).some((r) => r >= 1 && r <= 2);
		if (opts.status === 'controlled') return job.tier === 'staff-capable';
		return true;
	});
	if (!opts.pageSize) return { jobs: filtered, total: filtered.length };
	const start = ((opts.page ?? 1) - 1) * opts.pageSize;
	return { jobs: filtered.slice(start, start + opts.pageSize), total: filtered.length };
}

/**
 * กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1) — the read half of the public board.
 * Only whitelisted filters are forwarded to FastAPI; anything else is dropped.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const query = new URLSearchParams();
	const shelterCode = url.searchParams.get('shelter_code') || url.searchParams.get('shelter');
	const skills = url.searchParams.getAll('skill').filter(Boolean);
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const statusParam = url.searchParams.get('status');
	const status = BOARD_STATUSES.find((value) => value === statusParam);
	const page = positiveInt(url.searchParams.get('page'));
	const rawPageSize = positiveInt(url.searchParams.get('page_size'));
	const pageSize = rawPageSize ? Math.min(rawPageSize, MAX_PAGE_SIZE) : undefined;
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
		if (res.status === 429 || res.status === 404 || res.status === 400) {
			return json(await res.json(), { status: res.status });
		}
	} catch {
		// Fall through to CouchDB fallback if FastAPI is offline
	}

	try {
		const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		const regData = regRes.data as CouchAllDocsResponse<ShelterRegistryDoc> | undefined;

		const shelters: { code: string; name: string; db: string }[] = [];
		if (regRes.status === 200 && Array.isArray(regData?.rows)) {
			for (const r of regData.rows) {
				const doc = r.doc;
				if (doc && doc.type === 'shelter' && doc.code) {
					shelters.push({
						code: doc.code,
						name: doc.name || doc.code,
						db: doc.db || `shelter_${doc.code.toLowerCase()}`
					});
				}
			}
		}

		if (shelters.length === 0) {
			shelters.push({
				code: 'SH001',
				name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
				db: 'shelter_sh001'
			});
		}

		// Query jobs from relevant shelter databases
		const jobs: JobDoc[] = [];
		const targetShelters = shelterCode ? shelters.filter((s) => s.code === shelterCode) : shelters;

		for (const s of targetShelters) {
			try {
				const jobRes = await adminRaw(
					`/${s.db}/_all_docs?include_docs=true&startkey="job:"&endkey="job:\ufff0"`,
					'GET'
				);
				const jobData = jobRes.data as CouchAllDocsResponse<JobDoc> | undefined;
				if (jobRes.status === 200 && Array.isArray(jobData?.rows)) {
					for (const r of jobData.rows) {
						const doc = r.doc;
						if (
							doc &&
							doc.type === 'job' &&
							doc.status !== 'draft' &&
							doc.status !== 'closed' &&
							doc.status !== 'cancelled'
						) {
							jobs.push(doc);
						}
					}
				}
			} catch {
				// Ignore missing shelter database
			}
		}

		const result = filterFallbackJobs(jobs, { q, status, skills, page, pageSize });
		enrichJobsWithQuotaCounts(result.jobs);

		return json(
			{ success: true, jobs: result.jobs, total: result.total, shelters },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (err) {
		console.warn('Failed to load public volunteer jobs:', err);
		return json({ success: false, jobs: [], shelters: [] }, { status: 503 });
	}
};

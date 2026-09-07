import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';
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

interface JobAppDoc {
	_id: string;
	type: string;
	job_id?: string;
	shift_id?: string;
	selected_shift?: {
		shift_id?: string;
		date?: string;
		start_time?: string;
		end_time?: string;
	};
	status?: string;
}

interface CouchAppCounts {
	byJob: Record<string, number>;
	byShift: Record<string, number>;
}

async function getCouchApplicationCounts(
	shelters: { code: string; db: string }[]
): Promise<CouchAppCounts> {
	const appsByJob: Record<string, Set<string>> = {};
	const appsByShift: Record<string, Set<string>> = {};

	for (const s of shelters) {
		try {
			const appRes = await adminRaw(
				`/${s.db}/_all_docs?include_docs=true&startkey="job_application:"&endkey="job_application:\ufff0"`,
				'GET'
			);
			const appData = appRes.data as CouchAllDocsResponse<JobAppDoc> | undefined;
			if (appRes.status === 200 && Array.isArray(appData?.rows)) {
				for (const r of appData.rows) {
					const doc = r.doc;
					if (doc && doc.type === 'job_application' && doc.status !== 'cancelled') {
						const jid = (doc.job_id || '').replace(/^job:/, '');
						const appId = doc._id;
						if (jid && appId) {
							if (!appsByJob[jid]) appsByJob[jid] = new Set();
							appsByJob[jid].add(appId);

							const rawSid = doc.shift_id || doc.selected_shift?.shift_id;
							if (rawSid) {
								const key = `${jid}:${rawSid}`;
								if (!appsByShift[key]) appsByShift[key] = new Set();
								appsByShift[key].add(appId);
							}
							if (doc.selected_shift?.date) {
								const dateKey = `${jid}:${doc.selected_shift.date}`;
								if (!appsByShift[dateKey]) appsByShift[dateKey] = new Set();
								appsByShift[dateKey].add(appId);

								const dtKey = `${jid}:${doc.selected_shift.date}:${doc.selected_shift.start_time || ''}`;
								if (!appsByShift[dtKey]) appsByShift[dtKey] = new Set();
								appsByShift[dtKey].add(appId);
							}
						}
					}
				}
			}
		} catch {
			// ignore missing shelter database
		}
	}

	const byJob: Record<string, number> = {};
	for (const [jid, set] of Object.entries(appsByJob)) {
		byJob[jid] = set.size;
	}

	const byShift: Record<string, number> = {};
	for (const [key, set] of Object.entries(appsByShift)) {
		byShift[key] = set.size;
	}

	return { byJob, byShift };
}

function enrichJobsWithCouchCounts(jobs: JobDoc[], counts: CouchAppCounts): void {
	for (const job of jobs) {
		const cleanId = (job.job_id || job._id || '').replace(/^job:/, '');
		const couchApps = counts.byJob[cleanId] || 0;
		let shiftAppsSum = 0;

		if (job.shifts && Array.isArray(job.shifts)) {
			for (const shift of job.shifts) {
				const sid = shift.shift_id || shift.id || '';
				const dateKey = shift.date ? `${cleanId}:${shift.date}` : '';
				const dtKey = shift.date ? `${cleanId}:${shift.date}:${shift.start_time || ''}` : '';
				const shiftCouchApps =
					counts.byShift[`${cleanId}:${sid}`] ||
					(dtKey ? counts.byShift[dtKey] : 0) ||
					(dateKey ? counts.byShift[dateKey] : 0) ||
					0;
				const confirmed = shift.slots_confirmed ?? shift.confirmed ?? 0;
				shift.applicants_count = Math.max(shift.applicants_count || 0, shiftCouchApps, confirmed);
				shiftAppsSum += shift.applicants_count;
			}
		}

		job.applicants_count = Math.max(
			job.applicants_count || 0,
			couchApps,
			job.slots_confirmed || 0,
			shiftAppsSum
		);
	}
}

/**
 * กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1) — the read half of the public board.
 */
export const GET: RequestHandler = async ({ url, fetch, getClientAddress }) => {
	if (!volunteerTicketLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	const query = new URLSearchParams();
	const shelterCode = url.searchParams.get('shelter_code') || url.searchParams.get('shelter');
	const skill = url.searchParams.get('skill');
	if (shelterCode) query.set('shelter_code', shelterCode);
	if (skill) query.set('skill', skill);
	const suffix = query.size > 0 ? `?${query}` : '';

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/jobs${suffix}`, {
			headers: fastapiServiceHeaders()
		});
		if (res.ok) {
			const body = await res.json();
			if (Array.isArray(body?.jobs) && body.jobs.length > 0) {
				const targetShelterList = [
					{ code: shelterCode || 'SH001', db: `shelter_${(shelterCode || 'sh001').toLowerCase()}` }
				];
				const counts = await getCouchApplicationCounts(targetShelterList);
				enrichJobsWithCouchCounts(body.jobs as JobDoc[], counts);
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
							if (
								skill &&
								!doc.skills_required?.some((sk) => sk.toLowerCase().includes(skill.toLowerCase()))
							) {
								continue;
							}
							jobs.push(doc);
						}
					}
				}
			} catch {
				// Ignore missing shelter database
			}
		}

		const counts = await getCouchApplicationCounts(targetShelters);
		enrichJobsWithCouchCounts(jobs, counts);

		return json({ success: true, jobs, shelters }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.warn('Failed to load public volunteer jobs:', err);
		return json({ success: false, jobs: [], shelters: [] }, { status: 503 });
	}
};

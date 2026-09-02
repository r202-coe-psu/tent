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
		date: string;
		start_time: string;
		end_time: string;
		quota: number;
	}>;
	slots_confirmed?: number;
	slots_remaining?: number;
	is_urgent?: boolean;
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

		return json({ success: true, jobs, shelters }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		console.warn('Failed to load public volunteer jobs:', err);
		return json({ success: false, jobs: [], shelters: [] }, { status: 503 });
	}
};

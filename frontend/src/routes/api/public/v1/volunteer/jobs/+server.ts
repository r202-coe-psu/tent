import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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
 * GET /api/public/v1/volunteer/jobs
 * Public endpoint to list all available volunteer jobs across shelters without authentication.
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const shelterParam = url.searchParams.get('shelter')?.trim();
		const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		const regData = regRes.data as CouchAllDocsResponse<ShelterRegistryDoc> | undefined;

		const shelters: { code: string; name: string; db: string }[] = [];
		if (regRes.status === 200 && Array.isArray(regData?.rows)) {
			for (const r of regData.rows) {
				const doc = r.doc;
				if (doc && doc.type === 'shelter' && doc.code && doc.db) {
					shelters.push({
						code: doc.code,
						name: doc.name || doc.code,
						db: doc.db
					});
				}
			}
		}

		// Query jobs from relevant shelter databases
		const jobs: JobDoc[] = [];
		const targetShelters = shelterParam
			? shelters.filter((s) => s.code === shelterParam)
			: shelters;

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

		return json({ jobs, shelters }, { headers: { 'Cache-Control': 'public, max-age=60' } });
	} catch (err) {
		console.warn('Failed to load public volunteer jobs:', err);
		return json({ jobs: [], shelters: [] }, { status: 200 });
	}
};

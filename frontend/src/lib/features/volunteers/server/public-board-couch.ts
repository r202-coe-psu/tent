/**
 * Reads every shelter's job documents straight from CouchDB with the admin credential — the
 * public board's fallback while FastAPI is unreachable or failing. Server-only.
 */
import { adminRaw } from '$lib/server/couch-admin';
import type { FallbackJob, FallbackShelter } from './public-board-fallback';

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

/** Shelters from the registry and the open-for-board job docs of every one of them. */
export async function loadCouchBoard<
	Job extends FallbackJob & { type?: string; status?: string }
>(): Promise<{ shelters: FallbackShelter[]; jobs: Job[] }> {
	const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	const regData = regRes.data as CouchAllDocsResponse<ShelterRegistryDoc> | undefined;

	const shelters: FallbackShelter[] = [];
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

	// Every shelter's jobs: the shelter picker lists all shelters with a job (FR-6), whatever
	// the filters, like FastAPI.
	const jobs: Job[] = [];
	for (const s of shelters) {
		try {
			const jobRes = await adminRaw(
				`/${s.db}/_all_docs?include_docs=true&startkey="job:"&endkey="job:\ufff0"`,
				'GET'
			);
			const jobData = jobRes.data as CouchAllDocsResponse<Job> | undefined;
			if (jobRes.status === 200 && Array.isArray(jobData?.rows)) {
				for (const r of jobData.rows) {
					const doc = r.doc;
					if (
						doc &&
						doc.type === 'job' &&
						// What the board shows (`PUBLIC_JOB_STATUSES`, same as the worker), plus the retired
						// `almost_full` it still reads as `open`; `paused` is not shown.
						(doc.status === 'open' || doc.status === 'full' || doc.status === 'almost_full')
					) {
						// The DB names the shelter even when an older job doc does not.
						jobs.push({ ...doc, shelter_code: doc.shelter_code || s.code });
					}
				}
			}
		} catch {
			// Ignore missing shelter database
		}
	}
	return { shelters, jobs };
}

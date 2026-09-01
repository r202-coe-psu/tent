import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';
import { adminRaw } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

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

interface CouchFindResponse<T = Record<string, unknown>> {
	docs: T[];
	bookmark?: string;
	warning?: string;
}

interface ApplicationDoc {
	_id: string;
	type: string;
	job_id?: string;
	volunteer_id?: string;
	tracking_token?: string;
	status?: string;
	applicant?: {
		first_name?: string;
		last_name?: string;
		phone?: string;
		email?: string | null;
		skills?: string[];
	};
	selected_shift?: {
		date: string;
		start_time: string;
		end_time: string;
	};
	created_at?: string;
}

interface VolunteerDoc {
	_id: string;
	type: string;
	first_name: string;
	last_name?: string;
	phone?: string;
	volunteer_code?: string;
	tracking_token?: string;
	status?: string;
	created_at?: string;
}

interface JobTitleDoc {
	_id: string;
	type: string;
	title?: string;
}

/** Digital Pass (CR-092 screen 2). The token is the only credential. */
export const GET: RequestHandler = async ({ params, fetch, getClientAddress }) => {
	if (!volunteerTicketLimiter.check(getClientAddress())) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	const token = params.token?.trim();
	if (!token) {
		return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
	}

	// 1. Direct CouchDB query across shelter databases (including default shelter_sh001)
	try {
		const shelterDbs = new Map<string, { code: string; name: string }>();
		shelterDbs.set('shelter_sh001', { code: 'SH001', name: 'ศูนย์พักพิงหลัก (SH001)' });

		try {
			const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
			const regData = regRes.data as CouchAllDocsResponse<ShelterRegistryDoc> | undefined;
			if (regRes.status === 200 && Array.isArray(regData?.rows)) {
				for (const r of regData.rows) {
					const doc = r.doc;
					if (doc && doc.type === 'shelter' && doc.db) {
						shelterDbs.set(doc.db, {
							code: doc.code || 'SH001',
							name: doc.name || doc.code || 'SH001'
						});
					}
				}
			}
		} catch {
			// Ignore registry error
		}

		for (const [dbName, shelterInfo] of shelterDbs.entries()) {
			try {
				const docId = `job_application:${token}`;
				let app: ApplicationDoc | null = null;
				let volunteer: VolunteerDoc | null = null;

				// 1. Try finding job_application by direct ID
				const appRes = await adminRaw(`/${dbName}/${encodeURIComponent(docId)}`, 'GET');
				if (appRes.status === 200 && (appRes.data as ApplicationDoc | undefined)?._id) {
					app = appRes.data as ApplicationDoc;
				} else {
					// 2. Search job_application by tracking_token via _find
					const findRes = await adminRaw(`/${dbName}/_find`, 'POST', {
						selector: { type: 'job_application', tracking_token: token },
						limit: 1
					});
					const findData = findRes.data as CouchFindResponse<ApplicationDoc> | undefined;
					if (findRes.status === 200 && Array.isArray(findData?.docs) && findData.docs.length > 0) {
						app = findData.docs[0];
					} else {
						// 3. Search volunteer by tracking_token or ID
						const volFindRes = await adminRaw(`/${dbName}/_find`, 'POST', {
							selector: {
								type: 'volunteer',
								$or: [
									{ tracking_token: token },
									{ _id: token },
									{ _id: `volunteer:${token}` },
									{ volunteer_code: token }
								]
							},
							limit: 1
						});
						const volFindData = volFindRes.data as CouchFindResponse<VolunteerDoc> | undefined;
						if (
							volFindRes.status === 200 &&
							Array.isArray(volFindData?.docs) &&
							volFindData.docs.length > 0
						) {
							volunteer = volFindData.docs[0];
							// Find latest application for this volunteer
							const volAppsRes = await adminRaw(`/${dbName}/_find`, 'POST', {
								selector: {
									type: 'job_application',
									volunteer_id: volunteer._id
								},
								sort: [{ created_at: 'desc' }],
								limit: 1
							});
							const volAppsData = volAppsRes.data as CouchFindResponse<ApplicationDoc> | undefined;
							if (
								volAppsRes.status === 200 &&
								Array.isArray(volAppsData?.docs) &&
								volAppsData.docs.length > 0
							) {
								app = volAppsData.docs[0];
							}
						}
					}
				}

				if (app || volunteer) {
					let jobTitle = 'งานจิตอาสาประจำศูนย์พักพิง';
					if (app?.job_id) {
						try {
							const jobRes = await adminRaw(`/${dbName}/${encodeURIComponent(app.job_id)}`, 'GET');
							const jobData = jobRes.data as JobTitleDoc | undefined;
							if (jobRes.status === 200 && jobData?.title) {
								jobTitle = jobData.title;
							}
						} catch {
							// Ignore
						}
					}

					const applicantName = app?.applicant?.first_name
						? `${app.applicant.first_name} ${app.applicant.last_name || ''}`.trim()
						: volunteer
							? `${volunteer.first_name} ${volunteer.last_name || ''}`.trim()
							: 'จิตอาสาผู้สมัคร';

					const phone = app?.applicant?.phone || volunteer?.phone || '';
					const tokenOut = app?.tracking_token || volunteer?.tracking_token || token;

					return json(
						{
							success: true,
							ticket: {
								token: tokenOut,
								volunteer_id: volunteer?._id || app?.volunteer_id,
								job_title: jobTitle,
								shelter_name: shelterInfo.name,
								shelter_code: shelterInfo.code,
								status:
									app?.status || (volunteer?.status === 'active' ? 'confirmed' : 'pending_review'),
								date: app?.selected_shift?.date || new Date().toISOString().slice(0, 10),
								start_time: app?.selected_shift?.start_time || '08:00',
								end_time: app?.selected_shift?.end_time || '12:00',
								applicant_name: applicantName,
								phone: phone,
								created_at: app?.created_at || volunteer?.created_at || new Date().toISOString()
							}
						},
						{ headers: { 'Cache-Control': 'no-store' } }
					);
				}
			} catch {
				// Continue to next shelter db
			}
		}
	} catch {
		// Fallback to FastAPI
	}

	// 2. Fallback to FastAPI backend
	try {
		const res = await fetch(
			`${fastapiBaseUrl()}/public/v1/volunteer/ticket/${encodeURIComponent(token)}`,
			{
				headers: fastapiServiceHeaders()
			}
		);
		if (res.status === 404) {
			return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
		}
		if (!res.ok) {
			return json({ success: false, error: 'TICKET_FETCH_FAILED' }, { status: 502 });
		}
		return json(await res.json(), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch {
		return json({ success: false, error: 'TICKET_NOT_FOUND' }, { status: 404 });
	}
};

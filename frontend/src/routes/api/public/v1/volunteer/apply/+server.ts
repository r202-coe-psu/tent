import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';
import { adminRaw } from '$lib/server/couch-admin';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import { nextVolunteerCode } from '$lib/features/volunteers';

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

interface ExistingVolunteerDoc {
	_id: string;
	_rev?: string;
	type: string;
	schema_v?: number;
	shelter_code?: string;
	created_at?: string;
	updated_at?: string;
	created_by?: string;
	updated_by?: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
	phone: string;
	phone_hash: string;
	email?: string | null;
	skills?: string[];
	status?: string;
	checked_in?: boolean;
	tracking_token?: string;
	volunteer_code?: string;
	identity_verified?: boolean;
	source?: string;
	personnel_type?: string;
}

interface ExistingJobApplicationDoc {
	_id: string;
	_rev?: string;
	type: string;
	schema_v?: number;
	job_id?: string;
	volunteer_id?: string;
	applicant?: {
		first_name?: string;
		last_name?: string;
		phone?: string;
		phone_hash?: string;
		email?: string | null;
		skills?: string[];
	};
	selected_shift?: {
		shift_id?: string;
		date: string;
		start_time: string;
		end_time: string;
	};
	tracking_token?: string;
	status?: string;
	created_at?: string;
	updated_at?: string;
}

type ShelterDoc =
	ExistingVolunteerDoc | ExistingJobApplicationDoc | { _id: string; type: string; title?: string };

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

const applySchema = z.object({
	job_id: z.string().min(1),
	applicant: z.object({
		first_name: z.string().min(1, 'กรุณาระบุชื่อ'),
		last_name: z.string().min(1, 'กรุณาระบุนามสกุล'),
		phone: z
			.string()
			.transform((val) => val.replace(/[-\s]/g, '').trim())
			.pipe(z.string().regex(/^0\d{8,9}$/, 'เบอร์โทรศัพท์ไม่ถูกต้อง (เช่น 0812345678)')),
		email: z.string().email().nullable().optional(),
		skills: z.array(z.string()).default([])
	}),
	selected_shift: z.object({
		shift_id: z.string().min(1).optional(),
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
		start_time: z.string().min(1),
		end_time: z.string().min(1)
	}),
	recaptcha_token: z.string().optional()
});

function parseTimeToMinutes(t: string): number {
	if (!t) return 0;
	const [h, m] = t.split(':').map(Number);
	return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function isTimeOverlapping(
	d1: string,
	s1: string,
	e1: string,
	d2: string,
	s2: string,
	e2: string
): boolean {
	if (d1 !== d2) return false;
	const start1 = parseTimeToMinutes(s1);
	const end1 = parseTimeToMinutes(e1);
	const start2 = parseTimeToMinutes(s2);
	const end2 = parseTimeToMinutes(e2);
	return start1 < end2 && end1 > start2;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		const ip = getClientAddress();
		if (!volunteerApplyIpLimiter.check(ip)) {
			return json(
				{ success: false, error: 'RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' },
				{ status: 429 }
			);
		}

		const body = await request.json();
		const parseResult = applySchema.safeParse(body);
		if (!parseResult.success) {
			return json(
				{
					success: false,
					error: 'VALIDATION_ERROR',
					message: parseResult.error.issues[0]?.message || 'ข้อมูลไม่ถูกต้อง'
				},
				{ status: 400 }
			);
		}

		const { job_id, applicant, selected_shift, recaptcha_token } = parseResult.data;

		if (!volunteerApplyPhoneLimiter.check(applicant.phone.trim())) {
			return json(
				{
					success: false,
					error: 'RATE_LIMITED',
					message: 'เบอร์โทรนี้ส่งคำขอถี่เกินไป กรุณารอสักครู่'
				},
				{ status: 429 }
			);
		}

		// 1. Verify reCAPTCHA if token provided or env set
		if (env.SECRET_RECAPTCHA_KEY && recaptcha_token) {
			const isValidCaptcha = await captchaProvider.verifyToken(recaptcha_token, ip);
			if (!isValidCaptcha) {
				return json(
					{ success: false, error: 'CAPTCHA_FAILED', message: 'การตรวจสอบ reCAPTCHA ไม่ผ่าน' },
					{ status: 400 }
				);
			}
		}

		const phoneHash = await sha256Hex(applicant.phone.trim());
		const normalizedJobId = job_id.startsWith('job:') ? job_id : `job:${job_id}`;

		// 2. Locate target shelter database and shelter code
		let targetShelterDb = 'shelter_sh001';
		let targetShelterCode = 'SH001';

		try {
			const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
			const regData = regRes.data as CouchAllDocsResponse<ShelterRegistryDoc> | undefined;

			if (regRes.status === 200 && Array.isArray(regData?.rows)) {
				for (const r of regData.rows) {
					const doc = r.doc;
					if (doc && doc.type === 'shelter' && doc.code) {
						const dbName = `shelter_${doc.code.toLowerCase()}`;
						try {
							const jRes = await adminRaw(
								`/${dbName}/${encodeURIComponent(normalizedJobId)}`,
								'GET'
							);
							const jData = jRes.data as { _id?: string } | undefined;
							if (jRes.status === 200 && jData?._id) {
								targetShelterDb = dbName;
								targetShelterCode = doc.code;
								break;
							}
						} catch {
							// Continue searching
						}
					}
				}
			}
		} catch {
			// Fallback to default
		}

		// 3. Query existing volunteer profile and job applications for this phone
		const allDocsRes = await adminRaw(`/${targetShelterDb}/_all_docs?include_docs=true`, 'GET');
		const allDocsData = allDocsRes.data as CouchAllDocsResponse<ShelterDoc> | undefined;
		const existingVolunteerCodes: string[] = [];
		let existingVolunteer: ExistingVolunteerDoc | null = null;
		const existingActiveApps: ExistingJobApplicationDoc[] = [];

		if (allDocsRes.status === 200 && Array.isArray(allDocsData?.rows)) {
			for (const r of allDocsData.rows) {
				const doc = r.doc;
				if (!doc) continue;

				if (doc.type === 'volunteer') {
					const volDoc = doc as ExistingVolunteerDoc;
					if (volDoc.volunteer_code) {
						existingVolunteerCodes.push(volDoc.volunteer_code);
					}
					const isSamePhone =
						volDoc.phone_hash === phoneHash || volDoc.phone === applicant.phone.trim();
					if (isSamePhone && !existingVolunteer) {
						existingVolunteer = volDoc;
					}
				} else if (doc.type === 'job_application') {
					const appDoc = doc as ExistingJobApplicationDoc;
					const isSamePhone =
						appDoc.applicant?.phone_hash === phoneHash ||
						appDoc.applicant?.phone === applicant.phone.trim();
					if (isSamePhone && appDoc.status !== 'cancelled') {
						existingActiveApps.push(appDoc);
					}
				}
			}
		}

		// 4. CHECK TIME CONFLICT / OVERLAP
		for (const app of existingActiveApps) {
			const appShift = app.selected_shift;
			if (!appShift) continue;

			// Exact same job and shift time
			if (
				app.job_id === normalizedJobId &&
				(selected_shift.shift_id && appShift.shift_id
					? appShift.shift_id === selected_shift.shift_id
					: appShift.date === selected_shift.date &&
						appShift.start_time === selected_shift.start_time &&
						appShift.end_time === selected_shift.end_time)
			) {
				return json(
					{
						success: false,
						error: 'DUPLICATE_APPLICATION',
						message: 'คุณได้ทำการสมัครในกะงานนี้ไปแล้ว ไม่สามารถสมัครซ้ำได้'
					},
					{ status: 409 }
				);
			}

			// Time overlapping on the same date
			if (
				isTimeOverlapping(
					selected_shift.date,
					selected_shift.start_time,
					selected_shift.end_time,
					appShift.date,
					appShift.start_time,
					appShift.end_time
				)
			) {
				return json(
					{
						success: false,
						error: 'TIME_CONFLICT',
						message: 'ช่วงเวลากะงานที่เลือกทับซ้อนกับกะงานที่เคยลงทะเบียนไว้แล้ว กรุณาเลือกกะอื่น'
					},
					{ status: 409 }
				);
			}
		}

		function generateTrackingToken(): string {
			const bytes = new Uint8Array(16);
			crypto.getRandomValues(bytes);
			const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
				.join('')
				.toUpperCase();
			return `TKT-VOL-${hex}`;
		}

		// 5. CREATE OR UPDATE VOLUNTEER IDENTITY (APPEND TO VOLUNTEER)
		const now = new Date().toISOString();
		let volunteerId: string;
		let volunteerToken: string;
		let finalApplicantInfo: {
			first_name: string;
			last_name: string;
			phone: string;
			phone_hash: string;
			email: string | null;
			skills: string[];
		};

		if (existingVolunteer) {
			volunteerId = existingVolunteer._id;
			volunteerToken = existingVolunteer.tracking_token || generateTrackingToken();

			// Always preserve initial registration info from the first time
			finalApplicantInfo = {
				first_name: existingVolunteer.first_name,
				last_name: existingVolunteer.last_name,
				phone: existingVolunteer.phone || applicant.phone.trim(),
				phone_hash: phoneHash,
				email: existingVolunteer.email || (applicant.email ? applicant.email.trim() : null),
				skills: applicant.skills
			};

			// If new skills are submitted, append only the skills that were not present before
			const currentSkills: string[] = Array.isArray(existingVolunteer.skills)
				? existingVolunteer.skills
				: [];
			const newSkillsToAdd = applicant.skills.filter((s: string) => !currentSkills.includes(s));
			const combinedSkills = [...currentSkills, ...newSkillsToAdd];

			const updatedVolunteer = {
				...existingVolunteer,
				tracking_token: volunteerToken,
				skills: combinedSkills,
				updated_at: now,
				updated_by: 'public'
			};
			await adminRaw(
				`/${targetShelterDb}/${encodeURIComponent(existingVolunteer._id)}`,
				'PUT',
				updatedVolunteer
			);
		} else {
			volunteerId = `volunteer:vol_${ulid().toLowerCase()}`;
			volunteerToken = await sha256Hex(volunteerId);
			const nextCode = nextVolunteerCode(existingVolunteerCodes);

			finalApplicantInfo = {
				first_name: applicant.first_name.trim(),
				last_name: applicant.last_name.trim(),
				phone: applicant.phone.trim(),
				phone_hash: phoneHash,
				email: applicant.email ? applicant.email.trim() : null,
				skills: applicant.skills
			};

			const newVolunteerDoc = {
				_id: volunteerId,
				type: 'volunteer',
				schema_v: 3,
				shelter_code: targetShelterCode,
				created_at: now,
				updated_at: now,
				created_by: 'public',
				updated_by: 'public',
				first_name: finalApplicantInfo.first_name,
				last_name: finalApplicantInfo.last_name,
				phone: finalApplicantInfo.phone,
				phone_hash: phoneHash,
				email: finalApplicantInfo.email,
				skills: finalApplicantInfo.skills,
				status: 'active',
				checked_in: false,
				current_shelter_code: targetShelterCode,
				tracking_token: volunteerToken,
				volunteer_code: nextCode,
				identity_verified: false,
				source: 'public_apply',
				personnel_type: 'volunteer'
			};
			await adminRaw(
				`/${targetShelterDb}/${encodeURIComponent(volunteerId)}`,
				'PUT',
				newVolunteerDoc
			);
		}

		// 6. CREATE JOB_APPLICATION DOCUMENT (Schema v2)
		const applicationUlid = ulid();
		const docId = `job_application:${applicationUlid}`;
		const isControlled = applicant.skills.some(
			(s) => s.includes('แพทย์') || s.includes('พยาบาล') || s === 'medical'
		);
		const applicationStatus = isControlled ? 'pending_review' : 'confirmed';

		const applicationDoc = {
			_id: docId,
			type: 'job_application',
			schema_v: 3,
			job_id: normalizedJobId,
			shift_id: selected_shift.shift_id,
			volunteer_id: volunteerId,
			applicant: finalApplicantInfo,
			selected_shift: {
				shift_id: selected_shift.shift_id,
				date: selected_shift.date,
				start_time: selected_shift.start_time,
				end_time: selected_shift.end_time
			},
			tracking_token: volunteerToken,
			tracking_token_hash: await sha256Hex(volunteerToken),
			status: applicationStatus,
			review_notes: null,
			reviewed_at: null,
			reviewed_by: null,
			created_at: now,
			updated_at: now,
			created_by: 'public',
			updated_by: 'public'
		};

		await adminRaw(`/${targetShelterDb}/${encodeURIComponent(docId)}`, 'PUT', applicationDoc);

		// 7. CREATE SHIFT_ASSIGNMENT DOCUMENT (Schema v3)
		const assignmentId = `shift_assignment:${applicationUlid}`;
		const startTime = selected_shift.start_time || '08:00';
		const endTime = selected_shift.end_time || '16:00';
		const shiftDate = selected_shift.date || now.slice(0, 10);
		const startTs = `${shiftDate}T${startTime}:00Z`;
		let endTs = `${shiftDate}T${endTime}:00Z`;
		if (endTs <= startTs) {
			endTs = `${shiftDate}T23:59:59Z`;
		}

		const startHour = parseInt(startTime.split(':')[0] || '8', 10);
		let shiftKind = 'morning';
		if (startHour >= 6 && startHour < 14) shiftKind = 'morning';
		else if (startHour >= 14 && startHour < 22) shiftKind = 'afternoon';
		else shiftKind = 'night';

		const shiftAssignmentDoc = {
			_id: assignmentId,
			type: 'shift_assignment',
			schema_v: 3,
			shelter_code: targetShelterCode,
			job_id: normalizedJobId,
			volunteer_id: volunteerId,
			date: shiftDate,
			shift: shiftKind,
			station: 'จุดปฏิบัติการทั่วไป',
			duty_window: {
				start_ts: startTs,
				end_ts: endTs
			},
			check_in_at: null,
			check_out_at: null,
			check_in_by: null,
			status: 'assigned',
			dispatch_status: null,
			check_in_method: 'qr',
			check_in_reason: null,
			created_at: now,
			updated_at: now,
			created_by: 'public_apply',
			updated_by: 'public_apply'
		};

		await adminRaw(
			`/${targetShelterDb}/${encodeURIComponent(assignmentId)}`,
			'PUT',
			shiftAssignmentDoc
		);

		// 8. UPDATE JOB SLOTS IN COUCHDB
		try {
			const jobGetRes = await adminRaw(
				`/${targetShelterDb}/${encodeURIComponent(normalizedJobId)}`,
				'GET'
			);
			if (jobGetRes.status === 200 && jobGetRes.data) {
				const currentJob = jobGetRes.data as {
					_id: string;
					_rev: string;
					shifts?: {
						date: string;
						start_time: string;
						quota: number;
						slots_confirmed?: number;
						slots_remaining?: number;
					}[];
					slots_confirmed?: number;
					slots_remaining?: number;
					quota?: number;
					status?: string;
					updated_at?: string;
				};
				if (Array.isArray(currentJob.shifts)) {
					for (const s of currentJob.shifts) {
						if (s.date === shiftDate || (!s.date && s.start_time === startTime)) {
							s.slots_confirmed = (s.slots_confirmed || 0) + 1;
							s.slots_remaining = Math.max(0, (s.quota || 10) - s.slots_confirmed);
							break;
						}
					}
				}
				currentJob.slots_confirmed = (currentJob.slots_confirmed || 0) + 1;
				currentJob.slots_remaining = Math.max(
					0,
					(currentJob.quota || 10) - currentJob.slots_confirmed
				);
				if (currentJob.slots_remaining === 0) {
					currentJob.status = 'full';
				} else if (currentJob.slots_remaining <= 2) {
					currentJob.status = 'almost_full';
				}
				currentJob.updated_at = now;
				await adminRaw(
					`/${targetShelterDb}/${encodeURIComponent(normalizedJobId)}`,
					'PUT',
					currentJob
				);
			}
		} catch {
			// Non-fatal if job update fails
		}

		return json({
			success: true,
			tracking_token: volunteerToken,
			volunteer_id: volunteerId,
			status: applicationStatus,
			application: applicationDoc,
			message: existingVolunteer ? 'เพิ่มกะงานให้อาสาสมัครสำเร็จ' : 'ส่งใบสมัครสำเร็จ'
		});
	} catch (err: unknown) {
		console.error('Public volunteer apply error:', err);
		return json(
			{
				success: false,
				error: 'INTERNAL_ERROR',
				message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดภายในระบบ'
			},
			{ status: 500 }
		);
	}
};

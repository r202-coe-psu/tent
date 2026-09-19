/**
 * Volunteers feature slice seed — jobs, volunteers, shift_assignments, job_applications
 * (`docs/plans/volunteer-backoffice/00-foundation.md` §00.5), built exclusively through the
 * feature's own domain factories (`makeJob`, `makeVolunteer`, `makeJobApplication`,
 * `makeShiftAssignment`) — never a hand-rolled envelope.
 */
import { makeJob, jobSchema, type JobInput } from '$lib/features/volunteers/domain/job.schema';
import {
	makeVolunteer,
	volunteerSchema,
	type VolunteerInput
} from '$lib/features/volunteers/domain/volunteer.schema';
import {
	makeJobApplication,
	jobApplicationSchema,
	type JobApplicationInput
} from '$lib/features/volunteers/domain/job-application.schema';
import {
	makeShiftAssignment,
	shiftAssignmentSchema,
	type ShiftAssignmentInput,
	type ShiftKind
} from '$lib/features/volunteers/domain/shift-assignment.schema';
import {
	bangkokDateString,
	resolveDutyWindow,
	shiftDutyWindow
} from '$lib/features/volunteers/domain/duty-window';
import { nextVolunteerCode } from '$lib/features/volunteers/domain/volunteer-code';
import {
	initialStatusForSkills,
	reviewReasonsForApplication
} from '$lib/features/volunteers/domain/skills';
import { randomBytes } from 'node:crypto';
import { type AuthorContext, now } from '$lib/db/model';
import { sha256Hex } from '$lib/db/hash';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { bulkDocs, ensureDb, putDocUpsert } from './couch';
import { masterCodes, SH001_CODE, SH002_CODE, type MasterLookup } from './types';

const SH001_DB = shelterDbName(SH001_CODE);
const SH001_CTX: AuthorContext = { shelterCode: SH001_CODE, createdBy: 'seed' };
const SH002_DB = shelterDbName(SH002_CODE);
const SH002_CTX: AuthorContext = { shelterCode: SH002_CODE, createdBy: 'seed' };

/**
 * A readable, valid 128-bit fixture token used to log in and generate a role-card QR.
 * Job applications keep the real public-apply shape (hash only); seeded volunteer
 * profiles additionally keep the raw value on the document so a fixture can be opened
 * straight from CouchDB. Seed data only.
 */
function seedVolunteerToken(prefix: string): string {
	const body = prefix.toUpperCase().padEnd(32, '0').slice(0, 32);
	return `TKT-VOL-${body}`;
}

function seedApplicationToken(): string {
	return `TKT-VOL-${randomBytes(16).toString('hex').toUpperCase()}`;
}

const SEEDED_SCHEDULE_TOKEN = seedVolunteerToken('B1');

/**
 * `docs/plans/volunteer-backoffice/00-foundation.md` §00.5 — seed the `volunteers`
 * feature slice (jobs, volunteers, shift_assignments, job_applications) into SH001.
 * (`volunteer_transfer` was cut entirely by CR-104 AC-104-10.)
 *
 * `resolveDutyWindow(date, shift)` (Bangkok wall-clock → UTC, `duty-window.ts`) is
 * the ONLY source of `duty_window` values here — no hand-written ISO literals —
 * and `date` is always "today" computed the same way
 * `application/queries.ts#todayDateString` computes it (`bangkokDateString()`, the
 * Asia/Bangkok calendar date), so the seeded shift_assignments land inside the
 * Control Hub's "today" window (`useHubMetrics` / `useTodayAttendance`) the moment
 * the seed finishes.
 *
 * Quota reconciliation (job 1, "ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC", quota 6):
 * 2 volunteers currently hold an accepted slot (v1 standby, v2 checked_in; v3
 * completed is historical), 1 volunteer holds an outstanding dispatch offer (v4,
 * `dispatch_status: 'dispatched'` → `slots_dispatched = 1`), leaving
 * `slots_remaining = 3` — `2 + 1 + 3 = 6 = quota`, satisfying
 * `quota.ts#assertQuotaInvariant`. Jobs 2/3 seed no assignments/applications, so
 * their default `makeJob` slots (`0 confirmed + 0 dispatched + quota remaining`)
 * already satisfy the invariant untouched.
 *
 * Every doc here is minted with a ULID `_id` and this function performs no
 * "already seeded" guard — re-running the seed adds another batch, matching the
 * documented convention of the shelter volume seeds.
 */
export async function seedVolunteers(master: MasterLookup): Promise<void> {
	await ensureDb(SH001_DB);
	const ctx = SH001_CTX;

	// "Today" — Asia/Bangkok calendar date, matching
	// `application/queries.ts#todayDateString` exactly (the Control Hub /
	// attendance tab query by this same string).
	const today = bangkokDateString();
	// The 16:00–00:00 shift ends after midnight, so it carries the next day.
	const tomorrow = bangkokDateString(new Date(Date.now() + 86_400_000));

	function dutyWindowFor(shift: ShiftKind) {
		const window = resolveDutyWindow(today, shift);
		if (!window) throw new Error(`seedVolunteers: resolveDutyWindow(${today}, ${shift}) was null`);
		return window;
	}

	// — jobs ————————————————————————————————————————————————————————————————————
	const jobInputs: JobInput[] = [
		{
			title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC',
			description:
				'ต้อนรับและอำนวยความสะดวกผู้ประสานงานหน่วยงานภายนอกที่มาติดต่อศูนย์ประสานงานเหตุฉุกเฉิน (EOC) ' +
				'พร้อมประสานงานส่งต่อคำร้องไปยังฝ่ายที่เกี่ยวข้อง แต่งกายสุภาพ พูดจาดี ไม่จำเป็นต้องมีประสบการณ์',
			tier: 'operational',
			required_roles: [],
			// CR-100 — jobs store the master_data `volunteer_skills` code, not the label.
			skills_required: masterCodes(master, 'volunteer_skills', 'reception'),
			// schema_v 3 — capacity lives in the sub-shifts; quota = 3 + 3 = 6.
			shifts: [
				{
					id: `js-${today}-a`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 3
				},
				{
					id: `js-${today}-b`,
					date: today,
					end_date: tomorrow,
					start_time: '16:00',
					end_time: '00:00',
					quota: 3
				}
			],
			auto_accept: false,
			is_urgent: true
		},
		{
			title: 'เจ้าหน้าที่คัดกรองผู้ประสบภัย (Registration & Screening)',
			description:
				'ช่วยคีย์ข้อมูลลงทะเบียนผู้ประสบภัยเข้าศูนย์และคัดกรองอาการเบื้องต้นผ่านระบบ ต้องมีสิทธิ์เข้าระบบ ' +
				'(staff-capable) และผ่านการอบรมการใช้งานระบบลงทะเบียนก่อนเริ่มปฏิบัติงาน',
			tier: 'staff-capable',
			required_roles: ['registration_staff'],
			skills_required: masterCodes(master, 'volunteer_skills', 'screening'),
			shifts: [
				{
					id: `js-${today}-c`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '17:00',
					quota: 3
				}
			],
			auto_accept: false,
			is_urgent: false
		},
		{
			title: 'ทีมพลาธิการช่วยยกของ (Heavy Lifting)',
			description:
				'ช่วยขนย้ายของบริจาคและเสบียงระหว่างจุดพักของกับคลังศูนย์ ต้องมีร่างกายแข็งแรง ' +
				'สามารถยกของหนักได้ต่อเนื่อง ปิดรับสมัครชั่วคราวจนกว่าจะเปิดรับรอบถัดไป',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
			shifts: [
				{
					id: `js-${today}-d`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 8
				}
			],
			auto_accept: false,
			is_urgent: false
		},
		{
			title: 'ทีมครัวกลางและจัดเตรียมอาหารกล่องพระราชทาน',
			description:
				'ช่วยประกอบอาหาร บรรจุกล่อง และจัดเตรียมเสบียงอาหารปรุงสุกสำหรับแจกจ่ายผู้ประสบภัยในศูนย์พักพิง',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'cooking'),
			shifts: [
				{
					id: `js-${today}-e1`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '12:00',
					quota: 10
				},
				{
					id: `js-${today}-e2`,
					date: today,
					end_date: today,
					start_time: '12:00',
					end_time: '18:00',
					quota: 15
				}
			],
			auto_accept: true,
			is_urgent: true
		},
		{
			title: 'ทีมแพทย์และพยาบาลประจำจุดปฐมพยาบาล',
			description:
				'ดูแลผู้ป่วยเบื้องต้น ตรวจวัดสัญญาณชีพ และจ่ายยาสามัญประจำบ้านสำหรับผู้ประสบภัยในศูนย์',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'medical'),
			shifts: [
				{
					id: `js-${today}-f`,
					date: today,
					end_date: today,
					start_time: '08:00',
					end_time: '16:00',
					quota: 4
				}
			],
			auto_accept: false,
			is_urgent: true
		},
		{
			title: 'ทีมคลังพัสดุและขนย้ายถุงยังชีพฉุกเฉิน',
			description:
				'จัดเรียงสิ่งของบริจาค ตรวจนับสต็อก และแพ็คถุงยังชีพเพื่อส่งมอบให้ผู้ประสบภัยตามโซนต่างๆ',
			tier: 'operational',
			required_roles: [],
			skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
			shifts: [
				{
					id: `js-${today}-g`,
					date: today,
					end_date: today,
					start_time: '13:00',
					end_time: '17:00',
					quota: 8
				}
			],
			auto_accept: false,
			is_urgent: false
		}
	];
	const [job1, job2, job3, job4, job5, job6] = jobInputs.map((j) => makeJob(j, ctx));

	// job1: `open` + urgent, quota reconciled against the 4 shift_assignments
	// below (see the docblock invariant walkthrough above).
	job1.status = 'open';
	job1.slots_confirmed = 2;
	job1.slots_dispatched = 1;
	job1.slots_remaining = 3;
	// job2: `open` staff-capable
	job2.status = 'open';
	// job3: `paused` — temporarily not accepting, quota still fully unclaimed.
	job3.status = 'paused';
	// job4, job5, job6: `open`
	job4.status = 'open';
	job5.status = 'open';
	job6.status = 'open';
	for (const j of [job1, job2, job3, job4, job5, job6]) jobSchema.parse(j);

	// — volunteers ————————————————————————————————————————————————————————————
	// `source` covers all 4 enum values across the 5 profiles (public_apply
	// repeats once); `identity_verified` mixes true/false; v5 carries a
	// controlled skill (การแพทย์/ปฐมพยาบาล) and is left unverified — her
	// job_application below lands on `pending_review`, never `confirmed`
	// (`skills.ts#initialStatusForSkills`).
	const volunteerCodes: string[] = [];
	function mintVolunteerCode(): string {
		const c = nextVolunteerCode(volunteerCodes);
		volunteerCodes.push(c);
		return c;
	}

	const v1Input: VolunteerInput = {
		first_name: 'อรุณ',
		last_name: 'ใจกล้า',
		nickname: 'อรุณ',
		phone: '0821111111',
		email: null,
		// Store the Master Data codes, matching job.skills_required and the live
		// walk-in/profile forms. Labels are resolved by the UI at render time.
		skills: masterCodes(master, 'volunteer_skills', 'reception'),
		organization: null,
		national_id: null,
		source: 'public_apply'
	};
	const v2Input: VolunteerInput = {
		first_name: 'สมพงษ์',
		last_name: 'ยิ้มแย้ม',
		phone: '0822222222',
		email: null,
		skills: masterCodes(master, 'volunteer_skills', 'cooking', 'logistics'),
		organization: null,
		national_id: null,
		source: 'walk_in'
	};
	const v3Input: VolunteerInput = {
		first_name: 'ปิยะดา',
		last_name: 'คงมั่น',
		phone: '0823333333',
		email: null,
		skills: masterCodes(master, 'volunteer_skills', 'transport'),
		organization: 'มูลนิธิกู้ภัยหาดใหญ่',
		national_id: null,
		source: 'staff_entry'
	};
	const v4Input: VolunteerInput = {
		first_name: 'วราภรณ์',
		last_name: 'ศรีสุข',
		phone: '0824444444',
		email: null,
		skills: masterCodes(master, 'volunteer_skills', 'logistics'),
		organization: null,
		national_id: null,
		source: 'transfer'
	};
	const v5Input: VolunteerInput = {
		first_name: 'สุนิสา',
		last_name: 'แพทย์ทอง',
		nickname: 'หมอนิด',
		phone: '0825555555',
		email: null,
		// The master's own controlled item — this is what makes `initialStatusForSkills`
		// hold the seeded application at `pending_review`.
		skills: masterCodes(master, 'volunteer_skills', 'medical'),
		organization: 'รพ.สต. บ้านพรุ',
		national_id: null,
		source: 'public_apply'
	};

	const v1 = makeVolunteer(v1Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v2 = makeVolunteer(v2Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v3 = makeVolunteer(v3Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v4 = makeVolunteer(v4Input, ctx, { volunteer_code: mintVolunteerCode() });
	const v5 = makeVolunteer(v5Input, ctx, { volunteer_code: mintVolunteerCode() });

	// identity_verified mix — `makeVolunteer` always mints `false` (CR-094 §6
	// default); flip the 3 already-vetted profiles here.
	v1.identity_verified = true;
	v3.identity_verified = true;
	v4.identity_verified = true;
	const reviewedBy = 'seed-reviewer';
	const reviewedAt = now();
	for (const volunteer of [v1, v3, v4]) {
		volunteer.identity_verification = {
			status: 'verified',
			reviewed_at: reviewedAt,
			reviewed_by: reviewedBy,
			notes: 'ตรวจข้อมูลตัวตนจากชุดข้อมูลตัวอย่างแล้ว'
		};
	}
	v2.identity_verification = {
		status: 'pending',
		reviewed_at: null,
		reviewed_by: null,
		notes: null
	};
	v5.identity_verification = {
		status: 'pending',
		reviewed_at: null,
		reviewed_by: null,
		notes: null
	};
	v5.skill_verifications = Object.fromEntries(
		v5.skills.map((skill) => [
			skill,
			{ status: 'pending' as const, reviewed_at: null, reviewed_by: null, notes: null }
		])
	);
	// v2, v5 stay unverified — v5 doubles as the "controlled skill, not yet
	// approved" fixture required by 00-foundation.md §00.5.

	// v2 is presently on-shift (see shift_assignment a2 below) — reflects the
	// live flag `useCheckIn` would have set.
	v2.checked_in = true;
	v2.current_shelter_code = SH001_CODE;

	// Permanent role-card token (schema.md §2.8, CR-094): minted once per volunteer and
	// normally only ever persisted as a hash. Fixtures keep the raw value alongside it so
	// the seeded profiles can actually be opened in the Access Portal / QR scanner without
	// re-running the public apply flow — seed data only, never a production shape.
	const seededVolunteerTokens: Array<{ volunteer: typeof v1; token: string }> = [
		{ volunteer: v1, token: seedVolunteerToken('V1') },
		{ volunteer: v2, token: seedVolunteerToken('V2') },
		{ volunteer: v3, token: seedVolunteerToken('V3') },
		{ volunteer: v4, token: seedVolunteerToken('V4') },
		{ volunteer: v5, token: seedVolunteerToken('V5') }
	];
	for (const { volunteer, token } of seededVolunteerTokens) {
		if (volunteer.phone) volunteer.phone_hash = await sha256Hex(volunteer.phone);
		volunteer.tracking_token = token;
		volunteer.tracking_token_hash = await sha256Hex(token);
		volunteerSchema.parse(volunteer);
	}

	// — shift_assignments ————————————————————————————————————————————————————
	// All 4 against job1 (the `open` job), dated "today" so the Control Hub /
	// attendance tab show non-zero counts immediately after seeding.
	const a1Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-a`,
		volunteer_id: v1._id,
		date: today,
		shift: 'morning',
		station: 'จุดต้อนรับ',
		duty_window: dutyWindowFor('morning')
	};
	const a2Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-a`,
		volunteer_id: v2._id,
		date: today,
		shift: 'morning',
		station: 'ครัว',
		duty_window: dutyWindowFor('morning')
	};
	const a3Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-b`,
		volunteer_id: v3._id,
		date: today,
		shift: 'night',
		station: 'จุดตรวจ',
		duty_window: dutyWindowFor('night')
	};
	const a4Input: ShiftAssignmentInput = {
		job_id: job1._id,
		shift_id: `js-${today}-b`,
		volunteer_id: v4._id,
		date: today,
		shift: 'afternoon',
		station: 'พลาธิการ',
		duty_window: dutyWindowFor('afternoon')
	};

	// a1 — accepted, standing by before the shift starts.
	const a1 = makeShiftAssignment(a1Input, ctx, { status: 'standby' });
	// a2 — currently checked in (mirrors v2.checked_in above).
	const a2 = makeShiftAssignment(a2Input, ctx, {
		status: 'checked_in',
		check_in_at: now(),
		check_in_by: 'seed'
	});
	// a3 — finished an earlier shift today; check-in AND check-out both set.
	const a3 = makeShiftAssignment(a3Input, ctx, {
		status: 'completed',
		check_in_at: now(),
		check_in_by: 'seed'
	});
	a3.check_out_at = now();
	// a4 — dispatch offer outstanding, not yet accepted/declined
	// (`dispatch_status: 'dispatched'` ↔ job1.slots_dispatched = 1 above).
	const a4 = makeShiftAssignment(a4Input, ctx, {
		status: 'assigned',
		dispatch_status: 'dispatched'
	});

	for (const a of [a1, a2, a3, a4]) shiftAssignmentSchema.parse(a);

	// — job_applications ————————————————————————————————————————————————————
	const confirmedApplicationInput: JobApplicationInput = {
		job_id: job1._id,
		volunteer_id: v1._id,
		applicant: {
			first_name: v1.first_name,
			last_name: v1.last_name,
			phone: v1.phone ?? '',
			phone_hash: await sha256Hex(v1.phone ?? ''),
			email: v1.email ?? null,
			skills: v1.skills,
			national_id: v1.national_id ?? null
		},
		selected_shift: {
			shift_id: `js-${today}-a`,
			date: today,
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: seedApplicationToken()
	};
	const confirmedTrackingToken = confirmedApplicationInput.tracking_token;
	const confirmedApplication = makeJobApplication(confirmedApplicationInput, ctx, 'confirmed', {
		reviewReasons: []
	});
	confirmedApplication.tracking_token_hash = await sha256Hex(confirmedTrackingToken);
	delete confirmedApplication.tracking_token;
	confirmedApplication.reviewed_at = now();
	confirmedApplication.reviewed_by = 'seed';
	confirmedApplication.review_notes = 'ตรวจสอบแล้ว ทักษะตรงตามที่ต้องการ อนุมัติเข้าปฏิบัติงาน';

	// v5's controlled skill (การแพทย์/ปฐมพยาบาล) forces `pending_review` even
	// though job1.auto_accept is false anyway (skills.ts#initialStatusForSkills).
	const pendingApplicationInput: JobApplicationInput = {
		job_id: job1._id,
		volunteer_id: v5._id,
		applicant: {
			first_name: v5.first_name,
			last_name: v5.last_name,
			phone: v5.phone ?? '',
			phone_hash: await sha256Hex(v5.phone ?? ''),
			email: v5.email ?? null,
			skills: v5.skills,
			national_id: v5.national_id ?? null
		},
		selected_shift: {
			shift_id: `js-${today}-a`,
			date: today,
			start_time: '08:00',
			end_time: '16:00'
		},
		tracking_token: seedApplicationToken()
	};
	const pendingTrackingToken = pendingApplicationInput.tracking_token;
	const pendingStatus = initialStatusForSkills(v5.skills, {
		auto_accept: job1.auto_accept,
		tier: job1.tier
	});
	const pendingApplication = makeJobApplication(pendingApplicationInput, ctx, pendingStatus, {
		reviewReasons: reviewReasonsForApplication(v5.skills, job1)
	});
	pendingApplication.tracking_token_hash = await sha256Hex(pendingTrackingToken);
	delete pendingApplication.tracking_token;

	for (const app of [confirmedApplication, pendingApplication]) jobApplicationSchema.parse(app);

	const allDocs = [
		job1,
		job2,
		job3,
		job4,
		job5,
		job6,
		v1,
		v2,
		v3,
		v4,
		v5,
		a1,
		a2,
		a3,
		a4,
		confirmedApplication,
		pendingApplication
	];
	await bulkDocs(SH001_DB, allDocs);

	console.log(
		`  ✓ ${SH001_DB}: 6 jobs, 5 volunteers, 4 shift_assignments, 2 job_applications (today=${today})`
	);
	for (const { volunteer, token } of seededVolunteerTokens) {
		console.log(`    · ${volunteer.volunteer_code} ${volunteer.phone} token ${token}`);
	}
}

/**
 * Volunteer Job Board fixtures (CR-092 / T-28) for SH001 + SH002.
 *
 * Without these the public board at `/volunteers/jobs` is empty on a fresh database
 * and there is no way to fill it: the back-office screen that posts a job is T-29 and
 * does not exist yet, so the only alternative is hand-writing docs into CouchDB.
 *
 * Deliberately spans the three outcomes the apply flow can produce, because each takes
 * a different path through `_needs_review` and the slot counter:
 *
 * - `auto_accept` operational → confirmed ticket, takes a slot
 * - `staff-capable` → always queued for review whatever the flag says (F-AUTO)
 * - a controlled skill (พยาบาล) → queued even on an auto-accept operational job
 *
 * No `job_application` fixtures: an application must own a `tracking_token` its
 * applicant holds, and seeding one would either invent a token nobody has or leave a
 * ticket that cannot be opened. Apply through the UI to create them.
 */
export async function seedVolunteerJobs(master: MasterLookup): Promise<void> {
	await ensureDb(SH001_DB);
	await ensureDb(SH002_DB);
	const day = (offset: number) => bangkokDateString(new Date(Date.now() + offset * 86_400_000));
	const nextDay = (date: string) =>
		bangkokDateString(new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000));
	const shift = (id: string, date: string, start: string, end: string, quota: number) => ({
		id,
		date,
		end_date: end <= start ? nextDay(date) : date,
		start_time: start,
		end_time: end,
		quota
	});

	const jobs = [
		{
			db: SH001_DB,
			ctx: SH001_CTX,
			id: 'seedjob001',
			input: {
				title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
				description: 'ช่วยเตรียมวัตถุดิบ ปรุงอาหาร และแจกจ่ายอาหารกลางวันให้ผู้ประสบภัย',
				tier: 'operational' as const,
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'cooking'),
				shifts: [
					shift('seedshift001', day(1), '01:00', '05:00', 5),
					shift('seedshift002', day(3), '02:00', '08:00', 5),
					shift('seedshift003', day(-2), '01:00', '05:00', 5)
				],
				auto_accept: true,
				status: 'open' as const
			}
		},
		{
			db: SH001_DB,
			ctx: SH001_CTX,
			id: 'seedjob002',
			input: {
				title: 'ทีมยกของและจัดเรียงคลังสิ่งของบริจาค',
				description: 'ขนย้ายและจัดเรียงสิ่งของบริจาคเข้าคลัง ต้องยกของหนักได้',
				tier: 'operational' as const,
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'logistics'),
				shifts: [shift('seedjob002-shift', day(2), '13:00', '17:00', 6)],
				auto_accept: true,
				status: 'open' as const
			}
		},
		{
			db: SH001_DB,
			ctx: SH001_CTX,
			id: 'seedjob003',
			input: {
				title: 'พยาบาลอาสาประจำจุดปฐมพยาบาล',
				description: 'ดูแลจุดปฐมพยาบาล คัดกรองอาการเบื้องต้น ต้องมีใบประกอบวิชาชีพ',
				tier: 'operational' as const,
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'medical'),
				shifts: [shift('seedjob003-shift', day(2), '08:00', '16:00', 4)],
				auto_accept: true,
				status: 'open' as const
			}
		},
		{
			db: SH002_DB,
			ctx: SH002_CTX,
			id: 'seedjob004',
			input: {
				title: 'เจ้าหน้าที่ช่วยลงทะเบียนผู้ประสบภัย',
				description: 'ช่วยคีย์ข้อมูลผู้อพยพเข้าระบบที่จุดลงทะเบียน',
				tier: 'staff-capable' as const,
				required_roles: ['registration_staff'],
				skills_required: masterCodes(master, 'volunteer_skills', 'screening'),
				shifts: [shift('seedjob004-shift', day(2), '09:00', '15:00', 3)],
				auto_accept: false,
				status: 'open' as const
			}
		},
		{
			db: SH002_DB,
			ctx: SH002_CTX,
			id: 'seedjob005',
			input: {
				title: 'อาสาสมัครดูแลเด็กและกิจกรรมสันทนาการ',
				description: 'จัดกิจกรรมให้เด็กในศูนย์พักพิงช่วงเย็น',
				tier: 'operational' as const,
				required_roles: [],
				skills_required: masterCodes(master, 'volunteer_skills', 'childcare'),
				shifts: [shift('seedjob005-shift', day(3), '16:00', '19:00', 5)],
				auto_accept: true,
				status: 'open' as const
			}
		}
	] satisfies { db: string; ctx: AuthorContext; id: string; input: JobInput }[];

	for (const item of jobs) {
		const job = makeJob(item.input, item.ctx);
		job._id = `job:${item.id}`;
		if (item.id === 'seedjob001') {
			// seedshift001 is an outstanding offer; seedshift002 and seedshift003
			// already hold confirmed seats. Keep the job aggregate in sync with the
			// schema_v 4 assignments written by seedVolunteerSchedule below.
			job.slots_confirmed = 2;
			job.slots_dispatched = 1;
			job.slots_remaining = job.quota - 3;
		}
		jobSchema.parse(job);
		await putDocUpsert(item.db, { ...job });
	}

	console.log(`  ✓ volunteer jobs: ${jobs.length} schema_v 3 postings across SH001 + SH002`);
}

/**
 * A rostered volunteer for the Access Portal (CR-092 หน้าจอ 6 / T-28).
 *
 * `shift_assignment` is what ตารางทำงานจิตอาสา reads, and nothing can create one yet:
 * the screen that rosters people is the Dispatch Workspace in T-29. Without a fixture
 * the schedule is empty on a fresh database with no way to fill it.
 *
 * Sign in to the portal with **0891112222** to see these.
 *
 * The profile is seeded alongside because the worker reads `volunteer.phone_hash` when
 * projecting an assignment — that hash is the only route from a phone number to a
 * schedule, so an assignment whose volunteer is missing projects unreachable.
 */
export async function seedVolunteerSchedule(master: MasterLookup): Promise<void> {
	await ensureDb(SH001_DB);

	const phone = '0891112222';
	const volunteerId = 'seedvol001';
	// Use the same factory as the back-office flow. The old fixture used a hand-rolled
	// schema_v 1 document, which omitted volunteer_code/source/personnel_type and could
	// never carry the permanent role-card token needed by the QR scanner.
	const volunteer = makeVolunteer(
		{
			first_name: 'อาสา',
			last_name: 'ทดสอบ',
			phone,
			email: null,
			skills: masterCodes(master, 'volunteer_skills', 'cooking', 'logistics'),
			organization: null,
			national_id: null,
			source: 'walk_in',
			personnel_type: 'volunteer'
		},
		SH001_CTX,
		{ volunteer_code: 'V-006' }
	);
	volunteer._id = `volunteer:${volunteerId}`;
	volunteer.central_profile_id = volunteer._id;
	volunteer.phone_hash = await sha256Hex(phone);
	volunteer.tracking_token = SEEDED_SCHEDULE_TOKEN;
	volunteer.tracking_token_hash = await sha256Hex(SEEDED_SCHEDULE_TOKEN);
	volunteerSchema.parse(volunteer);
	await putDocUpsert(SH001_DB, { ...volunteer });

	// Relative to today so the fixture does not rot into a schedule of past shifts.
	const day = (offset: number) => {
		const d = new Date();
		d.setDate(d.getDate() + offset);
		return d.toISOString().slice(0, 10);
	};
	const shifts = [
		{
			id: 'seedshift001',
			date: day(1),
			station: 'ครัวกลาง',
			start: '01:00',
			end: '05:00',
			status: 'assigned',
			// Awaiting the volunteer's answer — this is what renders the Dispatch Card
			// with its accept / decline buttons.
			dispatch_status: 'dispatched',
			// The code a manager reads out over the phone. Fixed so the flow can be walked
			// through; real ones are minted when the shift is offered. Every character is
			// from the spoken alphabet — no 0/1/I/L/O/U, which is why it is not `SEED-01`.
			response_code: 'SEED-99'
		},
		{
			id: 'seedshift002',
			date: day(3),
			station: 'จุดลงทะเบียน',
			start: '02:00',
			end: '08:00',
			status: 'standby',
			dispatch_status: 'accepted'
		},
		{
			id: 'seedshift003',
			date: day(-2),
			station: 'คลังสิ่งของ',
			start: '01:00',
			end: '05:00',
			// A finished shift, so the portal has both an upcoming and a past entry to lay out.
			status: 'completed',
			dispatch_status: 'accepted'
		}
	];

	for (const shift of shifts) {
		const row = {
			id: shift.id,
			date: shift.date,
			end_date: shift.date,
			start_time: shift.start,
			end_time: shift.end,
			quota: 5
		};
		const assignmentInput: ShiftAssignmentInput = {
			job_id: 'job:seedjob001',
			shift_id: shift.id,
			volunteer_id: `volunteer:${volunteerId}`,
			date: shift.date,
			shift: 'custom',
			station: shift.station,
			duty_window: shiftDutyWindow(row)
		};
		const assignment = makeShiftAssignment(assignmentInput, SH001_CTX, {
			status: shift.status as 'assigned' | 'standby' | 'completed',
			dispatch_status: shift.dispatch_status as 'dispatched' | 'accepted',
			check_in_at: shift.status === 'completed' ? now() : null,
			check_in_by: shift.status === 'completed' ? 'seed' : null
		});
		if (shift.response_code) {
			(assignment as unknown as Record<string, unknown>).response_code = shift.response_code;
		}
		await putDocUpsert(SH001_DB, { ...assignment, _id: `shift_assignment:${shift.id}` });
	}

	console.log(
		`  ✓ volunteer schedule: 1 schema_v 4 profile + ${shifts.length} shifts (phone ${phone}, token ${SEEDED_SCHEDULE_TOKEN}, offer code SEED-99)`
	);
}

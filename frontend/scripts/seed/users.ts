import { hashSecurityAnswer } from '$lib/server/security-questions';
import { ensurePublicWriter } from '$lib/server/ensure-public-writer';
import { couchReq, env } from './couch';
import { SH001_CODE } from './types';

const USER_PREFIX = 'org.couchdb.user:';
const SEED_STAFF_PASSWORD = '!Q2w3e4r5t';

interface SeedUserConfig {
	name: string;
	display_name: string;
	roles: string[];
	personnel_type: 'staff' | 'volunteer';
	organization: string | null;
	position: string | null;
	phone: string;
	email: string | null;
	shelter_id: string | null;
	question_id:
		| 'high_school'
		| 'birth_province'
		| 'first_pet'
		| 'primary_school'
		| 'favorite_teacher'
		| 'first_workplace';
	raw_answer: string;
}

const SEED_USERS: SeedUserConfig[] = [
	{
		name: 'sa01',
		display_name: 'ผู้ดูแลระบบสูงสุด (System Admin)',
		roles: ['system_admin'],
		personnel_type: 'staff',
		organization: 'ศูนย์ปฏิบัติการส่วนกลาง (EOC)',
		position: 'System Administrator',
		phone: '0800000001',
		email: 'sa01@smart-shelter.org',
		shelter_id: null,
		question_id: 'birth_province',
		raw_answer: 'กรุงเทพมหานคร'
	},
	{
		name: 'staff01',
		display_name: 'สมชาย ประจำการ (Staff 01)',
		roles: ['shelter:SH001', 'registration_staff', 'triage_staff'],
		personnel_type: 'staff',
		organization: 'กรมป้องกันและบรรเทาสาธารณภัย',
		position: 'เจ้าหน้าที่รับลงทะเบียนและคัดกรอง',
		phone: '0812345601',
		email: 'staff01@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'high_school',
		raw_answer: 'กรุงเทพคริสเตียน'
	},
	{
		name: 'staff02',
		display_name: 'พว. สมหญิง การุณ (Staff 02)',
		roles: ['shelter:SH001', 'medical_staff'],
		personnel_type: 'staff',
		organization: 'โรงพยาบาลศูนย์หาดใหญ่',
		position: 'พยาบาลวิชาชีพ',
		phone: '0812345602',
		email: 'staff02@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'first_pet',
		raw_answer: 'เจ้าด่าง'
	},
	{
		name: 'staff03',
		display_name: 'วิชัย มั่นคง (Staff 03)',
		roles: ['shelter:SH001', 'volunteer_coordinator', 'supply_coordinator', 'kitchen_staff'],
		personnel_type: 'staff',
		organization: 'มูลนิธิกระจกเงา',
		position: 'ผู้ประสานงานจิตอาสาและคลัง',
		phone: '0812345603',
		email: 'staff03@smart-shelter.org',
		shelter_id: SH001_CODE,
		question_id: 'favorite_teacher',
		raw_answer: 'ครูสมศรี'
	},
	{
		name: '0891234567',
		display_name: 'กิตติ จิตอาสา (Volunteer Staff)',
		roles: ['shelter:SH001', 'registration_staff'],
		personnel_type: 'volunteer',
		organization: 'กลุ่มอาสาใจถึงใจ',
		position: 'อาสาช่วยงานลงทะเบียน',
		phone: '0891234567',
		email: 'volunteer01@example.com',
		shelter_id: SH001_CODE,
		question_id: 'primary_school',
		raw_answer: 'อนุบาลวัดป่า'
	}
];

async function seedPublicWriter(): Promise<void> {
	const result = await ensurePublicWriter(
		couchReq,
		process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL
	);
	if (result.outcome === 'skipped') {
		console.log('  – _users: COUCHDB_PUBLIC_WRITER_URL unset — public writer not seeded');
		return;
	}
	console.log(
		`  ✓ _users: public writer "${result.username}" (${result.outcome === 'created' ? 'created' : 'already exists'})`
	);
}

/** Staging/local test logins — not part of prod master init. */
export async function seedUsers(): Promise<void> {
	let created = 0;
	let updated = 0;

	for (const u of SEED_USERS) {
		const docId = `${USER_PREFIX}${encodeURIComponent(u.name)}`;
		const existing = await couchReq('GET', `/_users/${docId}`);
		const existingDoc = existing.status === 200 ? (existing.data as Record<string, unknown>) : null;

		const { answer_hash, salt } = hashSecurityAnswer(u.raw_answer);
		const security_question = {
			question_id: u.question_id,
			answer_hash,
			salt,
			set_at: new Date().toISOString()
		};

		const userDoc: Record<string, unknown> = {
			...(existingDoc ?? {}),
			name: u.name,
			display_name: u.display_name,
			roles: u.roles,
			type: 'user',
			personnel_type: u.personnel_type,
			organization: u.organization,
			position: u.position,
			phone: u.phone,
			email: u.email,
			shelter_id: u.shelter_id,
			active: true,
			must_change_password: false,
			security_question,
			affiliation_tags: (existingDoc?.affiliation_tags as string[]) ?? []
		};

		if (!existingDoc) {
			userDoc.password = SEED_STAFF_PASSWORD;
		}

		const { status } = await couchReq('PUT', `/_users/${docId}`, userDoc);
		if (status === 201) {
			if (existingDoc) updated += 1;
			else created += 1;
		} else if (status === 409) {
			const latest = await couchReq('GET', `/_users/${docId}`);
			if (latest.status === 200) {
				const latestDoc = latest.data as Record<string, unknown>;
				userDoc._rev = latestDoc._rev;
				await couchReq('PUT', `/_users/${docId}`, userDoc);
				updated += 1;
			}
		} else {
			throw new Error(`PUT _users/${u.name} failed (HTTP ${status})`);
		}
	}

	console.log(
		`  ✓ _users: sa01, staff01–03, 0891234567 (${created} created, ${updated} updated with metadata)`
	);

	await seedPublicWriter();
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as couchAdmin from './couch-admin';
import {
	createUser,
	resetUserPasswordByAdmin,
	getSecurityQuestionChallenge,
	verifySecurityQuestionAndResetPassword,
	setupSecurityQuestionAndResetPassword,
	type CouchUserDoc
} from './user-service';
import { hashSecurityAnswer } from './security-questions';

type FakeUserDoc = CouchUserDoc & { password?: string };

describe('user-service', () => {
	let fakeUsersDb: Record<string, FakeUserDoc>;

	beforeEach(() => {
		fakeUsersDb = {};
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
			const cleanPath = path.split('?')[0];

			if (method === 'GET' && cleanPath === '/_users/_all_docs') {
				const rows = Object.values(fakeUsersDb).map((doc) => ({
					id: doc._id,
					key: doc._id,
					value: { rev: doc._rev },
					doc
				}));
				return { status: 200, data: { rows } };
			}

			if (method === 'GET' && cleanPath.startsWith('/_users/org.couchdb.user:')) {
				const id = cleanPath.slice('/_users/'.length);
				const doc = fakeUsersDb[id];
				if (!doc) return { status: 404, data: { error: 'not_found', reason: 'missing' } };
				return { status: 200, data: { ...doc } };
			}

			if (method === 'PUT' && cleanPath.startsWith('/_users/org.couchdb.user:')) {
				const id = cleanPath.slice('/_users/'.length);
				const docBody = (body ?? {}) as FakeUserDoc;
				if (fakeUsersDb[id] && !docBody._rev) {
					return { status: 409, data: { error: 'conflict', reason: 'Document update conflict.' } };
				}
				const rev = `1-${Date.now()}`;
				fakeUsersDb[id] = { ...docBody, _id: id, _rev: rev };
				return { status: 201, data: { ok: true, id, rev } };
			}

			if (method === 'DELETE' && cleanPath.startsWith('/_users/org.couchdb.user:')) {
				const id = cleanPath.slice('/_users/'.length);
				if (!fakeUsersDb[id]) return { status: 404, data: { error: 'not_found' } };
				delete fakeUsersDb[id];
				return { status: 200, data: { ok: true } };
			}

			return { status: 200, data: { ok: true } };
		});
	});

	it('creates a user with profile metadata and multiple roles', async () => {
		await createUser({
			name: '0812345678',
			password: 'Password123!',
			display_name: 'สมชาย ประจำการ',
			personnel_type: 'staff',
			organization: 'ปภ. เชียงใหม่',
			phone: '0812345678',
			roles: ['shelter:SH001', 'registration_staff', 'triage_staff']
		});

		const saved = fakeUsersDb['org.couchdb.user:0812345678'];
		expect(saved).toBeDefined();
		expect(saved.name).toBe('0812345678');
		expect(saved.display_name).toBe('สมชาย ประจำการ');
		expect(saved.personnel_type).toBe('staff');
		expect(saved.organization).toBe('ปภ. เชียงใหม่');
		expect(saved.roles).toEqual(['shelter:SH001', 'registration_staff', 'triage_staff']);
		expect(saved.active).toBe(true);
	});

	it('accepts a volunteer phone as a forced first-login password', async () => {
		await createUser({
			name: 'volunteer@example.com',
			password: '0812345678',
			display_name: 'อาสา ทดลอง',
			personnel_type: 'volunteer',
			phone: '0812345678',
			roles: ['shelter:SH001', 'registration_staff'],
			must_change_password: true
		});

		const saved = fakeUsersDb['org.couchdb.user:volunteer%40example.com'];
		expect(saved.password).toBe('0812345678');
		expect(saved.must_change_password).toBe(true);
	});

	it('resets user password by admin with memorable temporary passphrase', async () => {
		await createUser({
			name: '0899999999',
			password: 'InitialPassword1!',
			display_name: 'สมหญิง อาสา',
			personnel_type: 'volunteer',
			phone: '0899999999',
			roles: ['shelter:SH001', 'registration_staff']
		});

		const caller = {
			name: 'sa01',
			roles: ['system_admin'],
			isSA: true,
			isManager: false,
			shelterCode: null
		};

		const result = await resetUserPasswordByAdmin('0899999999', caller);
		expect(result.temporary_password).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{2,4}!$/);

		const updated = fakeUsersDb['org.couchdb.user:0899999999'];
		expect(updated.must_change_password).toBe(true);
	});

	it('provides security question challenge and verifies answer to reset password', async () => {
		const { answer_hash, salt } = hashSecurityAnswer('สวนกุหลาบวิทยาลัย');
		await createUser({
			name: '0811112222',
			password: 'InitialPassword1!',
			display_name: 'นาย กู้คืน',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0811112222',
			roles: ['shelter:SH001', 'registration_staff'],
			security_question: {
				question_id: 'high_school',
				answer_hash,
				salt,
				set_at: new Date().toISOString()
			}
		});

		// 1. Get challenge
		const challenge = await getSecurityQuestionChallenge('0811112222');
		expect(challenge.found).toBe(true);
		expect(challenge.question_id).toBe('high_school');
		expect(challenge.question_label).toBe('โรงเรียนมัธยมที่คุณเคยศึกษาคือที่ใด?');

		// 2. Verify with wrong answer -> throws
		await expect(
			verifySecurityQuestionAndResetPassword(
				'0811112222',
				'high_school',
				'ผิดโรงเรียน',
				'BrandNewPass123!'
			)
		).rejects.toThrow();

		// 3. Verify with correct answer -> resets password
		await verifySecurityQuestionAndResetPassword(
			'0811112222',
			'high_school',
			'  สวนกุหลาบวิทยาลัย  ',
			'BrandNewPass123!'
		);

		const updated = fakeUsersDb['org.couchdb.user:0811112222'];
		expect(updated.password).toBe('BrandNewPass123!');
		expect(updated.must_change_password).toBe(false);
	});

	it('supports setupSecurityQuestionAndResetPassword for first login', async () => {
		await createUser({
			name: '0855554444',
			password: 'TempPassword1!',
			display_name: 'ผู้ใช้ใหม่',
			personnel_type: 'staff',
			organization: 'เทศบาล',
			phone: '0855554444',
			roles: ['shelter:SH001', 'registration_staff']
		});

		await setupSecurityQuestionAndResetPassword({
			username: '0855554444',
			new_password: 'PermanentPass123!',
			question_id: 'birth_province',
			raw_answer: 'เชียงใหม่'
		});

		const updated = fakeUsersDb['org.couchdb.user:0855554444'];
		expect(updated.password).toBe('PermanentPass123!');
		expect(updated.must_change_password).toBe(false);
		expect(updated.security_question).toBeDefined();
		expect(updated.security_question?.question_id).toBe('birth_province');
	});
});

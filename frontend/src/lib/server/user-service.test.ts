import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as couchAdmin from './couch-admin';
import {
	createUser,
	resetUserPasswordByAdmin,
	getCurrentUserProfile,
	getSecurityQuestionChallenge,
	verifySecurityQuestionAndResetPassword,
	setupSecurityQuestionAndResetPassword,
	linkGoogleMfa,
	unlinkGoogleMfa,
	getGoogleMfa,
	linkThaidMfa,
	unlinkThaidMfa,
	getThaidMfa,
	touchThaidMfaVerified,
	findUserByThaidSubject,
	listUsers,
	touchGoogleMfaVerified,
	findUserByGoogleSubject,
	updateOwnProfile,
	resolveLoginName,
	findUserNameByPhone
} from './user-service';
import type { CouchUserDoc } from './user-service';
import { hashSecurityAnswer } from './security-questions';
import { ServiceError } from './couch-admin';

/** `_users` docs carry the password field that `CouchUserDoc` intentionally omits. */
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
				const docBody = (body ?? {}) as Partial<FakeUserDoc>;
				if (fakeUsersDb[id] && !docBody._rev) {
					return { status: 409, data: { error: 'conflict', reason: 'Document update conflict.' } };
				}
				const rev = `1-${Date.now()}`;
				fakeUsersDb[id] = { ...docBody, _id: id, _rev: rev } as FakeUserDoc;
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

	it('stores null phone when omitted (username-only account)', async () => {
		await createUser({
			name: 'staff01',
			password: 'Password123!',
			display_name: 'Staff One',
			personnel_type: 'staff',
			organization: 'ปภ.',
			roles: ['shelter:SH001', 'registration_staff']
		});

		const saved = fakeUsersDb['org.couchdb.user:staff01'];
		expect(saved.phone).toBeNull();
	});

	it('rejects phone that collides with another user phone', async () => {
		await createUser({
			name: 'staff_a',
			password: 'Password123!',
			display_name: 'A',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0811111111',
			roles: ['shelter:SH001', 'registration_staff']
		});

		await expect(
			createUser({
				name: 'staff_b',
				password: 'Password123!',
				display_name: 'B',
				personnel_type: 'staff',
				organization: 'ปภ.',
				phone: '0811111111',
				roles: ['shelter:SH001', 'registration_staff']
			})
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('rejects phone that collides with another username', async () => {
		await createUser({
			name: '0812222222',
			password: 'Password123!',
			display_name: 'Phone User',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: null,
			roles: ['shelter:SH001', 'registration_staff']
		});

		await expect(
			createUser({
				name: 'staff_c',
				password: 'Password123!',
				display_name: 'C',
				personnel_type: 'staff',
				organization: 'ปภ.',
				phone: '0812222222',
				roles: ['shelter:SH001', 'registration_staff']
			})
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('resolveLoginName returns username for matching phone', async () => {
		await createUser({
			name: 'staff01',
			password: 'Password123!',
			display_name: 'Staff',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0899998888',
			roles: ['shelter:SH001', 'registration_staff']
		});

		await expect(resolveLoginName('0899998888')).resolves.toBe('staff01');
		await expect(resolveLoginName('staff01')).resolves.toBe('staff01');
		await expect(resolveLoginName('0810000000')).resolves.toBe('0810000000');
		await expect(findUserNameByPhone('0899998888')).resolves.toBe('staff01');
		await expect(findUserNameByPhone('0810000000')).resolves.toBeNull();
	});

	it('getCurrentUserProfile returns display_name from _users when present', async () => {
		fakeUsersDb['org.couchdb.user:staff1'] = {
			_id: 'org.couchdb.user:staff1',
			_rev: '1-abc',
			name: 'staff1',
			type: 'user',
			roles: [],
			display_name: 'Staff One'
		};

		await expect(getCurrentUserProfile('staff1')).resolves.toEqual({
			name: 'staff1',
			display_name: 'Staff One'
		});
	});

	it('getCurrentUserProfile falls back to username when _users doc is missing', async () => {
		// Bootstrap CouchDB admin often has a session but no app profile doc.
		await expect(getCurrentUserProfile('admin')).resolves.toEqual({
			name: 'admin',
			display_name: 'admin'
		});
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

	it('resolves forgot-password challenge by contact phone when name differs', async () => {
		const { answer_hash, salt } = hashSecurityAnswer('แม่น้ำเจ้าพระยา');
		await createUser({
			name: 'staff_recover',
			password: 'InitialPassword1!',
			display_name: 'Recover',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0877776666',
			roles: ['shelter:SH001', 'registration_staff'],
			security_question: {
				question_id: 'birth_province',
				answer_hash,
				salt,
				set_at: new Date().toISOString()
			}
		});

		const challenge = await getSecurityQuestionChallenge('0877776666');
		expect(challenge.found).toBe(true);
		expect(challenge.question_id).toBe('birth_province');

		await verifySecurityQuestionAndResetPassword(
			'0877776666',
			'birth_province',
			'แม่น้ำเจ้าพระยา',
			'NewPassword1!'
		);
		expect(fakeUsersDb['org.couchdb.user:staff_recover'].must_change_password).toBe(false);
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

	describe('Google MFA (CR-124)', () => {
		async function seedUser(name: string) {
			await createUser({
				name,
				password: 'Password123!',
				display_name: name,
				personnel_type: 'staff',
				phone: name,
				roles: ['shelter:SH001', 'registration_staff']
			});
		}

		it('links Google MFA and exposes summary flags', async () => {
			await seedUser('0810000001');
			await linkGoogleMfa('0810000001', {
				subject: 'google-sub-aaa',
				email: 'alice@example.com'
			});

			const doc = fakeUsersDb['org.couchdb.user:0810000001'];
			const google = getGoogleMfa(doc);
			expect(google?.type).toBe('google');
			expect(google?.subject).toBe('google-sub-aaa');
			expect(google?.email).toBe('alice@example.com');
			expect(google?.linked_at).toBeTruthy();
			expect(google?.verified_at).toBeTruthy();

			const caller = {
				name: 'sa01',
				roles: ['system_admin'],
				isSA: true,
				shelterCode: null
			};
			const listed = await listUsers(caller);
			const row = listed.find((u) => u.name === '0810000001');
			expect(row?.mfa_enrolled).toBe(true);
			expect(row?.mfa_google_email).toBe('alice@example.com');
		});

		it('rejects linking the same Google subject to another user (CONFLICT)', async () => {
			await seedUser('0810000002');
			await seedUser('0810000003');
			await linkGoogleMfa('0810000002', { subject: 'shared-sub', email: 'a@x.com' });

			await expect(
				linkGoogleMfa('0810000003', { subject: 'shared-sub', email: 'b@x.com' })
			).rejects.toMatchObject({ code: 'CONFLICT' });
		});

		it('rejects a second Google provider on the same user (CONFLICT)', async () => {
			await seedUser('0810000004');
			await linkGoogleMfa('0810000004', { subject: 'first-sub', email: 'one@x.com' });

			await expect(
				linkGoogleMfa('0810000004', { subject: 'second-sub', email: 'two@x.com' })
			).rejects.toMatchObject({ code: 'CONFLICT' });
		});

		it('unlinks Google MFA and clears summary enrollment', async () => {
			await seedUser('0810000005');
			await linkGoogleMfa('0810000005', { subject: 'unlink-sub', email: 'u@x.com' });
			await unlinkGoogleMfa('0810000005');

			const doc = fakeUsersDb['org.couchdb.user:0810000005'];
			expect(getGoogleMfa(doc)).toBeNull();
			expect(doc.mfa).toBeNull();

			const caller = {
				name: 'sa01',
				roles: ['system_admin'],
				isSA: true,
				shelterCode: null
			};
			const listed = await listUsers(caller);
			const row = listed.find((u) => u.name === '0810000005');
			expect(row?.mfa_enrolled).toBe(false);
			expect(row?.mfa_google_email).toBeNull();
		});

		it('updates verified_at on successful step-up touch', async () => {
			await seedUser('0810000006');
			await linkGoogleMfa('0810000006', { subject: 'touch-sub', email: 't@x.com' });
			const before = getGoogleMfa(fakeUsersDb['org.couchdb.user:0810000006'])!.verified_at;
			await new Promise((r) => setTimeout(r, 5));
			await touchGoogleMfaVerified('0810000006');
			const after = getGoogleMfa(fakeUsersDb['org.couchdb.user:0810000006'])!.verified_at;
			expect(after).toBeTruthy();
			expect(after! >= before!).toBe(true);
		});

		it('findUserByGoogleSubject returns the enrolled user or null', async () => {
			await seedUser('0810000007');
			await seedUser('0810000008');
			await linkGoogleMfa('0810000007', { subject: 'lookup-sub', email: 'l@x.com' });
			fakeUsersDb['org.couchdb.user:0810000008'].mfa = { providers: [] };

			const found = await findUserByGoogleSubject('lookup-sub');
			expect(found?.name).toBe('0810000007');
			expect(await findUserByGoogleSubject('unknown-sub')).toBeNull();
			expect(await findUserByGoogleSubject('')).toBeNull();
		});

		it('findUserByGoogleSubject ignores docs without a google provider', async () => {
			await seedUser('0810000009');
			fakeUsersDb['org.couchdb.user:0810000009'].mfa = { providers: [] };
			expect(await findUserByGoogleSubject('nope')).toBeNull();
		});
	});

	describe('ThaID MFA (CR-ThaID)', () => {
		async function seedUser(name: string) {
			fakeUsersDb[`org.couchdb.user:${name}`] = {
				_id: `org.couchdb.user:${name}`,
				_rev: '1-abc',
				name,
				type: 'user',
				roles: ['shelter:SH001', 'registration_staff'],
				display_name: 'เจ้าหน้าที่',
				phone: name
			};
		}

		it('links ThaID MFA and surfaces in user summary', async () => {
			await seedUser('0820000001');
			await linkThaidMfa('0820000001', {
				subject: 'thaid-sub-001',
				name: 'นาย ประชา สุขใจ',
				pid_masked: '1-xxxx-xxxxx-12-3'
			});

			const doc = fakeUsersDb['org.couchdb.user:0820000001'];
			const thaid = getThaidMfa(doc);
			expect(thaid).toMatchObject({
				type: 'thaid',
				subject: 'thaid-sub-001',
				name: 'นาย ประชา สุขใจ',
				pid_masked: '1-xxxx-xxxxx-12-3'
			});

			const caller = {
				name: 'sa01',
				roles: ['system_admin'],
				isSA: true,
				shelterCode: null
			};
			const listed = await listUsers(caller);
			const row = listed.find((u) => u.name === '0820000001');
			expect(row?.mfa_enrolled).toBe(true);
			expect(row?.mfa_thaid_name).toBe('นาย ประชา สุขใจ');
			expect(row?.mfa_thaid_pid_masked).toBe('1-xxxx-xxxxx-12-3');
		});

		it('allows linking both Google and ThaID on the same user', async () => {
			await seedUser('0820000002');
			await linkGoogleMfa('0820000002', { subject: 'google-sub-2', email: 'g2@x.com' });
			await linkThaidMfa('0820000002', {
				subject: 'thaid-sub-2',
				name: 'นางสาว สมศรี ดีงาม',
				pid_masked: '2-xxxx-xxxxx-45-6'
			});

			const doc = fakeUsersDb['org.couchdb.user:0820000002'];
			expect(getGoogleMfa(doc)?.subject).toBe('google-sub-2');
			expect(getThaidMfa(doc)?.subject).toBe('thaid-sub-2');

			const caller = {
				name: 'sa01',
				roles: ['system_admin'],
				isSA: true,
				shelterCode: null
			};
			const listed = await listUsers(caller);
			const row = listed.find((u) => u.name === '0820000002');
			expect(row?.mfa_enrolled).toBe(true);
			expect(row?.mfa_google_email).toBe('g2@x.com');
			expect(row?.mfa_thaid_name).toBe('นางสาว สมศรี ดีงาม');
			expect(row?.mfa_thaid_pid_masked).toBe('2-xxxx-xxxxx-45-6');
		});

		it('rejects linking the same ThaID subject to another user (CONFLICT)', async () => {
			await seedUser('0820000003');
			await seedUser('0820000004');
			await linkThaidMfa('0820000003', { subject: 'shared-thaid-sub' });

			await expect(
				linkThaidMfa('0820000004', { subject: 'shared-thaid-sub' })
			).rejects.toMatchObject({ code: 'CONFLICT' });
		});

		it('rejects a second ThaID provider on the same user (CONFLICT)', async () => {
			await seedUser('0820000005');
			await linkThaidMfa('0820000005', { subject: 'first-thaid-sub' });

			await expect(
				linkThaidMfa('0820000005', { subject: 'second-thaid-sub' })
			).rejects.toMatchObject({ code: 'CONFLICT' });
		});

		it('unlinks ThaID MFA and preserves Google MFA if present', async () => {
			await seedUser('0820000006');
			await linkGoogleMfa('0820000006', { subject: 'g-stay', email: 'stay@x.com' });
			await linkThaidMfa('0820000006', { subject: 't-remove' });

			await unlinkThaidMfa('0820000006');

			const doc = fakeUsersDb['org.couchdb.user:0820000006'];
			expect(getThaidMfa(doc)).toBeNull();
			expect(getGoogleMfa(doc)?.subject).toBe('g-stay');

			const caller = {
				name: 'sa01',
				roles: ['system_admin'],
				isSA: true,
				shelterCode: null
			};
			const listed = await listUsers(caller);
			const row = listed.find((u) => u.name === '0820000006');
			expect(row?.mfa_enrolled).toBe(true);
			expect(row?.mfa_google_email).toBe('stay@x.com');
			expect(row?.mfa_thaid_name).toBeNull();
		});

		it('unlinks ThaID MFA and clears enrollment when it was the only provider', async () => {
			await seedUser('0820000007');
			await linkThaidMfa('0820000007', { subject: 't-only' });
			await unlinkThaidMfa('0820000007');

			const doc = fakeUsersDb['org.couchdb.user:0820000007'];
			expect(getThaidMfa(doc)).toBeNull();
			expect(doc.mfa).toBeNull();
		});

		it('updates verified_at on touchThaidMfaVerified', async () => {
			await seedUser('0820000008');
			await linkThaidMfa('0820000008', { subject: 'touch-t-sub' });
			const before = getThaidMfa(fakeUsersDb['org.couchdb.user:0820000008'])!.verified_at;
			await new Promise((r) => setTimeout(r, 5));
			await touchThaidMfaVerified('0820000008');
			const after = getThaidMfa(fakeUsersDb['org.couchdb.user:0820000008'])!.verified_at;
			expect(after).toBeTruthy();
			expect(after! >= before!).toBe(true);
		});

		it('findUserByThaidSubject finds enrolled user or returns null', async () => {
			await seedUser('0820000009');
			await linkThaidMfa('0820000009', { subject: 'lookup-t-sub' });

			const found = await findUserByThaidSubject('lookup-t-sub');
			expect(found?.name).toBe('0820000009');
			expect(await findUserByThaidSubject('not-exist')).toBeNull();
			expect(await findUserByThaidSubject('')).toBeNull();
		});
	});

	describe('updateOwnProfile', () => {
		function seedProfileUser(name: string) {
			fakeUsersDb[`org.couchdb.user:${name}`] = {
				_id: `org.couchdb.user:${name}`,
				_rev: '1-abc',
				name,
				type: 'user',
				roles: ['shelter:SH001', 'registration_staff'],
				display_name: 'เดิม',
				phone: '0811111111',
				email: 'old@example.com',
				organization: 'ปภ. เดิม',
				position: 'เจ้าหน้าที่',
				personnel_type: 'staff'
			};
		}

		it('updates allowed soft fields and trims values', async () => {
			seedProfileUser('0812222222');
			const summary = await updateOwnProfile('0812222222', {
				display_name: '  สมชาย ใจดี  ',
				phone: ' 0899999999 ',
				email: ' new@example.com ',
				organization: ' ปภ. ใหม่ ',
				position: ' หัวหน้ากะ '
			});

			const saved = fakeUsersDb['org.couchdb.user:0812222222'];
			expect(saved.display_name).toBe('สมชาย ใจดี');
			expect(saved.phone).toBe('0899999999');
			expect(saved.email).toBe('new@example.com');
			expect(saved.organization).toBe('ปภ. ใหม่');
			expect(saved.position).toBe('หัวหน้ากะ');
			expect(saved.roles).toEqual(['shelter:SH001', 'registration_staff']);
			expect(summary.display_name).toBe('สมชาย ใจดี');
		});

		it('rejects restricted keys such as roles and password', async () => {
			seedProfileUser('0813333333');
			await expect(
				updateOwnProfile('0813333333', {
					display_name: 'ok',
					roles: ['system_admin']
				} as never)
			).rejects.toMatchObject({
				code: 'VALIDATION',
				message: expect.stringContaining('roles')
			} satisfies Partial<ServiceError>);

			expect(fakeUsersDb['org.couchdb.user:0813333333'].roles).toEqual([
				'shelter:SH001',
				'registration_staff'
			]);
		});

		it('rejects empty display_name after trim', async () => {
			seedProfileUser('0814444444');
			await expect(updateOwnProfile('0814444444', { display_name: '   ' })).rejects.toMatchObject({
				code: 'VALIDATION'
			});
		});

		it('clears optional fields when empty string is sent', async () => {
			seedProfileUser('0815555555');
			const summary = await updateOwnProfile('0815555555', {
				email: '',
				organization: null,
				position: '  ',
				phone: ''
			});
			const saved = fakeUsersDb['org.couchdb.user:0815555555'];
			expect(saved.email).toBeNull();
			expect(saved.organization).toBeNull();
			expect(saved.position).toBeNull();
			expect(saved.phone).toBeNull();
			expect(summary.phone).toBeNull();
			expect(summary.email).toBeNull();
		});

		it('throws when user doc is missing', async () => {
			await expect(updateOwnProfile('missing-user', { display_name: 'x' })).rejects.toMatchObject({
				code: 'VALIDATION'
			});
		});
	});
});

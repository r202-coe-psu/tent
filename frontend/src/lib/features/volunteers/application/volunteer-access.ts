import { z } from 'zod';
import { passwordSchema } from '$lib/auth/password-schema';
import { STAFF_CAPABILITIES, shelterScopeRole } from '$lib/auth/roles';
import { createUser, listUsers } from '$lib/features/users';
import { volunteerRepositoryFor } from '../data/volunteer.remote';
import type { Volunteer } from '../domain/volunteer.schema';

export const volunteerAccessSchema = z.object({
	email: z.string().trim().email('กรุณากรอกอีเมลให้ถูกต้อง'),
	password: z.string().trim().min(1, 'กรุณากำหนดรหัสผ่าน'),
	role: z.enum(STAFF_CAPABILITIES)
});

/** Create credentials first, then link the latest profile; an exact existing link is retryable. */
export async function grantVolunteerAccess(
	volunteer: Volunteer,
	input: z.infer<typeof volunteerAccessSchema>
): Promise<{ created: boolean }> {
	const { email, password, role } = volunteerAccessSchema.parse(input);
	const isPhoneBootstrapPassword =
		password === (volunteer.phone?.trim() ?? '') && /^0\d{9}$/.test(password);
	if (!isPhoneBootstrapPassword) passwordSchema.parse(password);
	const repository = volunteerRepositoryFor(volunteer.shelter_code);
	const profile = await repository.get(volunteer._id);
	if (!profile) throw new Error('ไม่พบข้อมูลอาสาสมัคร กรุณาโหลดข้อมูลใหม่');
	const scope = shelterScopeRole(volunteer.shelter_code);
	const users = await listUsers();
	const existing = users.find((user) => user.name === email);
	const otherLinkedAccount = users.find(
		(user) =>
			user.volunteer_id === volunteer._id && user.roles.includes(scope) && user.name !== email
	);
	if (otherLinkedAccount) {
		throw new Error(
			`อาสาสมัครนี้มีบัญชี ${otherLinkedAccount.name} แล้ว กรุณาจัดการผ่านหน้าผู้ใช้งาน`
		);
	}
	if (
		profile.user_name &&
		profile.user_name !== email &&
		users.some((user) => user.name === profile.user_name)
	) {
		throw new Error('โปรไฟล์อาสาสมัครผูกกับบัญชีอื่นแล้ว กรุณาจัดการผ่านหน้าผู้ใช้งาน');
	}
	if (
		existing &&
		(existing.volunteer_id !== volunteer._id ||
			existing.personnel_type !== 'volunteer' ||
			existing.active === false ||
			existing.roles.length !== 2 ||
			!existing.roles.includes(scope) ||
			!existing.roles.includes(role))
	) {
		throw new Error('อีเมลนี้มีบัญชีอยู่แล้วหรือสิทธิ์ไม่ตรงกัน กรุณาจัดการผ่านหน้าผู้ใช้งาน');
	}
	const created = !existing;
	if (created) {
		await createUser({
			name: email,
			password,
			display_name: `${profile.first_name} ${profile.last_name}`.trim(),
			roles: [scope, role],
			personnel_type: 'volunteer',
			organization: profile.organization ?? null,
			phone: profile.phone,
			email,
			volunteer_id: volunteer._id,
			must_change_password: isPhoneBootstrapPassword
		});
	}
	try {
		const latest = await repository.get(volunteer._id);
		if (!latest) throw new Error('ไม่พบข้อมูลอาสาสมัคร');
		if (latest.user_name !== profile.user_name && latest.user_name && latest.user_name !== email) {
			throw new Error('โปรไฟล์ถูกผูกกับบัญชีอื่นระหว่างบันทึก');
		}
		await repository.update({ ...latest, user_name: email, email });
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'บันทึกโปรไฟล์ไม่สำเร็จ';
		throw new Error(
			`${created ? 'สร้างบัญชีแล้ว' : 'บัญชีมีอยู่แล้ว'} แต่ผูกโปรไฟล์ไม่สำเร็จ: ${reason} กรุณาลองบันทึกอีกครั้งด้วยอีเมลและบทบาทเดิม ระบบจะผูกบัญชีโดยไม่เปลี่ยนรหัสผ่าน`,
			{ cause: error }
		);
	}
	return { created };
}

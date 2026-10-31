/**
 * Field errors for the first-login / admin-reset setup page (#1065): every problem is reported
 * under its own field in Thai, with the same password rules as the server.
 */
import { passwordPolicyError } from '$lib/auth/password-schema';
import { SECURITY_QUESTIONS } from '$lib/auth/security-questions';

export type ForceSetupField = 'question' | 'answer' | 'newPassword' | 'confirmPassword';
export type ForceSetupErrors = Partial<Record<ForceSetupField, string>>;

export function forceSetupFieldErrors(input: {
	questionId: string;
	answer: string;
	newPassword: string;
	confirmPassword: string;
	mustChangePassword: boolean;
}): ForceSetupErrors {
	const errors: ForceSetupErrors = {};
	if (!SECURITY_QUESTIONS.some((q) => q.id === input.questionId)) {
		errors.question = 'กรุณาเลือกคำถามความปลอดภัย';
	}
	if (!input.answer.trim()) errors.answer = 'กรุณากรอกคำตอบความปลอดภัย';

	const password = input.newPassword;
	if (input.mustChangePassword && !password.trim()) {
		errors.newPassword = 'กรุณากรอกรหัสผ่านใหม่';
	} else if (password) {
		const policy = passwordPolicyError(password);
		if (policy) errors.newPassword = policy;
	}
	if (password && password !== input.confirmPassword) {
		errors.confirmPassword = 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน';
	}
	return errors;
}

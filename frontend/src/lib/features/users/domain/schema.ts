import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
import { SA_GRANTABLE_CAPABILITIES } from '$lib/auth/roles';
import { passwordSchema } from '$lib/auth/password-schema';
import { SECURITY_QUESTION_IDS } from '$lib/auth/security-questions';

export const personnelTypeSchema = z.enum(['staff', 'volunteer']);
export type PersonnelType = z.infer<typeof personnelTypeSchema>;

/** 10-digit mobile phone number (08xxxxxxxx, 09xxxxxxxx, 06xxxxxxxx) */
export const phoneSchema = z
	.string()
	.trim()
	.regex(/^0[0-9]{9}$/, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0');

/** Username: allows phone number or alphanumeric (letters, digits, _, -, .) */
export const usernameSchema = z
	.string()
	.trim()
	.min(3, 'Username ต้องมีอย่างน้อย 3 ตัวอักษร')
	.regex(
		/^[a-zA-Z0-9_.-]+$/,
		'Username ต้องประกอบด้วยตัวอักษรภาษาอังกฤษ ตัวเลข หรือเบอร์โทรศัพท์เท่านั้น'
	);

/** Capability the new user is granted (SA may pick any including system_admin; SM staff/coordinator capabilities). */
export const capabilitySchema = z.enum(SA_GRANTABLE_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/** Duty window for time-bound volunteer access */
export const dutyWindowSchema = z
	.object({
		start_ts: z.string().datetime({ message: 'รูปแบบเวลาเริ่มต้นไม่ถูกต้อง' }),
		end_ts: z.string().datetime({ message: 'รูปแบบเวลาสิ้นสุดไม่ถูกต้อง' })
	})
	.refine(
		(val) => new Date(val.start_ts).getTime() < new Date(val.end_ts).getTime(),
		{
			message: 'เวลาเริ่มต้นต้องมาก่อนเวลาสิ้นสุด',
			path: ['end_ts']
		}
	);

export type DutyWindow = z.infer<typeof dutyWindowSchema>;

/**
 * Form input for creating a user.
 */
export const createUserSchema = z
	.object({
		username: usernameSchema,
		password: passwordSchema,
		display_name: z.string().trim().min(1, 'ชื่อที่แสดงต้องไม่ว่าง'),
		personnel_type: personnelTypeSchema.default('staff'),
		organization: z.string().trim().optional(),
		position: z.string().trim().optional(),
		phone: phoneSchema,
		email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').or(z.literal('')).optional(),
		notes: z.string().trim().optional(),
		capabilities: z
			.array(capabilitySchema)
			.min(1, 'ต้องเลือกอย่างน้อย 1 บทบาท')
			.optional(),
		/** Backward-compatibility for single-select capability */
		capability: capabilitySchema.optional(),
		shelter_id: shelterCodeSchema.optional(),
		volunteer_id: z.string().optional(),
		duty_window: dutyWindowSchema.optional(),
		affiliation_tags: z.array(z.string()).optional()
	})
	.superRefine((data, ctx) => {
		// If capabilities not given, fallback to single capability
		const caps = data.capabilities ?? (data.capability ? [data.capability] : []);
		if (caps.length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'ต้องเลือกอย่างน้อย 1 บทบาท',
				path: ['capabilities']
			});
		}
		// Organization is required for staff
		if (data.personnel_type === 'staff' && (!data.organization || data.organization.length === 0)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'กรุณาระบุหน่วยงานหรือองค์กรต้นสังกัดสำหรับเจ้าหน้าที่',
				path: ['organization']
			});
		}
	});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Form input for editing an existing user.
 */
export const editUserSchema = z
	.object({
		username: z.string().trim().min(1, 'Username is required'),
		password: passwordSchema.or(z.literal('')),
		display_name: z.string().trim().min(1, 'Display name is required'),
		personnel_type: personnelTypeSchema.default('staff'),
		organization: z.string().trim().optional(),
		position: z.string().trim().optional(),
		phone: phoneSchema,
		email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง').or(z.literal('')).optional(),
		notes: z.string().trim().optional(),
		capabilities: z
			.array(capabilitySchema)
			.min(1, 'ต้องเลือกอย่างน้อย 1 บทบาท')
			.optional(),
		capability: capabilitySchema.optional(),
		shelter_id: shelterCodeSchema.optional(),
		volunteer_id: z.string().optional(),
		duty_window: dutyWindowSchema.optional(),
		affiliation_tags: z.array(z.string()).optional()
	})
	.superRefine((data, ctx) => {
		const caps = data.capabilities ?? (data.capability ? [data.capability] : []);
		if (caps.length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'ต้องเลือกอย่างน้อย 1 บทบาท',
				path: ['capabilities']
			});
		}
		if (data.personnel_type === 'staff' && (!data.organization || data.organization.length === 0)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'กรุณาระบุหน่วยงานหรือองค์กรต้นสังกัดสำหรับเจ้าหน้าที่',
				path: ['organization']
			});
		}
	});

export type EditUserInput = z.infer<typeof editUserSchema>;

export type UserFormInput = CreateUserInput & EditUserInput;

/** Security question setup schema */
export const securityQuestionSetupSchema = z.object({
	question_id: z.enum(SECURITY_QUESTION_IDS, {
		message: 'กรุณาเลือกคำถามความปลอดภัยที่ถูกต้อง'
	}),
	answer: z.string().trim().min(1, 'กรุณากรอกคำตอบความปลอดภัย')
});

export type SecurityQuestionSetupInput = z.infer<typeof securityQuestionSetupSchema>;

/** Forgot password verification & reset schema */
export const forgotPasswordVerifySchema = z.object({
	phone: phoneSchema,
	question_id: z.enum(SECURITY_QUESTION_IDS, {
		message: 'กรุณาเลือกคำถามความปลอดภัยที่ถูกต้อง'
	}),
	answer: z.string().trim().min(1, 'กรุณากรอกคำตอบความปลอดภัย'),
	new_password: passwordSchema
});

export type ForgotPasswordVerifyInput = z.infer<typeof forgotPasswordVerifySchema>;

/** Force setup input schema (first login or admin reset) */
export const forceSetupSchema = z.object({
	new_password: passwordSchema.optional(),
	security_question: securityQuestionSetupSchema
});

export type ForceSetupInput = z.infer<typeof forceSetupSchema>;

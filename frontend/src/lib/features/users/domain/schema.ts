import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
import { SA_GRANTABLE_CAPABILITIES } from '$lib/auth/roles';
import { passwordSchema } from '$lib/auth/password-schema';

/** Capability the new user is granted (SA may pick any including system_admin; SM only staff). */
export const capabilitySchema = z.enum(SA_GRANTABLE_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Form input for creating a user. `shelter_id` is supplied by an SA; for a
 * shelter_manager it is implicit (their own shelter) and the server derives it.
 * `system_admin` does not take a shelter (`shelter_id` omitted).
 */
export const createUserSchema = z.object({
	username: z.string().min(3, 'Username ต้องมีอย่างน้อย 3 ตัวอักษร'),
	password: passwordSchema,
	display_name: z.string().min(1, 'ชื่อที่แสดงต้องไม่ว่าง'),
	capability: capabilitySchema,
	shelter_id: shelterCodeSchema.optional(),
	affiliation_tags: z.array(z.string()).optional()
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const editUserSchema = z.object({
	username: z.string(),
	password: passwordSchema.or(z.literal('')),
	display_name: z.string().min(1, 'Display name is required'),
	capability: capabilitySchema,
	shelter_id: shelterCodeSchema.optional(),
	affiliation_tags: z.array(z.string()).optional()
});

export type EditUserInput = z.infer<typeof editUserSchema>;

/**
 * What the shared user form emits. Create and edit produce the same shape — the schemas differ
 * only in strictness (edit accepts an empty password, meaning "keep the current one").
 */
export type UserFormInput = CreateUserInput & EditUserInput;

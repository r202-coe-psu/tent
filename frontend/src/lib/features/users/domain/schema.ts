import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
import { SHELTER_CAPABILITIES } from '$lib/auth/roles';

/** Capability the new user is granted (SA may pick any; SM only the staff ones). */
export const capabilitySchema = z.enum(SHELTER_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Form input for creating a user. `shelter_code` is supplied by an SA; for a
 * shelter_manager it is implicit (their own shelter) and the server derives it.
 */
export const createUserSchema = z.object({
	username: z.string().min(3, 'Username must be at least 3 characters'),
	password: z.string().min(6, 'Password must be at least 6 characters'),
	capability: capabilitySchema,
	shelter_code: shelterCodeSchema.optional()
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

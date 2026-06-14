import { z } from 'zod';

/** Form input for provisioning a shelter — code is auto-assigned by the server. */
export const createShelterSchema = z.object({
	name: z.string().trim().min(1, 'Name is required')
});

export type CreateShelterInput = z.infer<typeof createShelterSchema>;

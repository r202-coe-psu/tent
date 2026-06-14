import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';

/** Form input for provisioning a shelter (workshop: explicit code, not counter-minted). */
export const createShelterSchema = z.object({
	shelter_code: shelterCodeSchema,
	name: z.string().trim().min(1, 'Name is required')
});

export type CreateShelterInput = z.infer<typeof createShelterSchema>;

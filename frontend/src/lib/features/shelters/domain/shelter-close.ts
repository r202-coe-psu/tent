import { z } from 'zod';

/**
 * Shelter close (CR-219) — the contract shared by the confirm modal and the
 * `/api/back-office/shelter/[code]/close` route. Pure: no I/O.
 */

/** FR-17: trim and collapse repeated whitespace; case is kept as typed. */
export function normalizeShelterCloseConfirmText(text: string): string {
	return text.trim().replace(/\s+/g, ' ');
}

/** FR-17: the phrase staff must type — `<shelter_code> <shelter name>`. */
export function shelterCloseConfirmPhrase(code: string, name: string): string {
	return normalizeShelterCloseConfirmText(`${code} ${name}`);
}

/** FR-8 / FR-17: true when the typed text matches the phrase (server re-checks it). */
export function matchesShelterCloseConfirm(input: string, code: string, name: string): boolean {
	return normalizeShelterCloseConfirmText(input) === shelterCloseConfirmPhrase(code, name);
}

/** POST body of the close route (FR-8). */
export const shelterCloseRequestSchema = z.object({ confirm_text: z.string() });
export type ShelterCloseRequest = z.infer<typeof shelterCloseRequestSchema>;

/** GET response of the close route (FR-7): affected people per stay status. */
export const shelterClosePreviewSchema = z.object({
	by_status: z.record(z.string(), z.number().int().nonnegative()),
	total: z.number().int().nonnegative()
});
export type ShelterClosePreview = z.infer<typeof shelterClosePreviewSchema>;

/** POST response of the close route (FR-14). */
export const shelterCloseResultSchema = z.object({
	closed: z.boolean(),
	checked_out: z.number().int().nonnegative(),
	cancelled: z.number().int().nonnegative(),
	failed: z.array(z.object({ evacuee_id: z.string(), error: z.string() }))
});
export type ShelterCloseResult = z.infer<typeof shelterCloseResultSchema>;

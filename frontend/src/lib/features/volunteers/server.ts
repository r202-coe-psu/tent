/**
 * Server-safe entry point for the volunteers feature.
 *
 * The barrel (`$lib/features/volunteers`) re-exports Svelte components and TanStack
 * hooks. Importing it from a `+server.ts` pulls those into the SSR module graph, and
 * `DigitalPass` reaches `qrcode` — a CommonJS package that dies there with
 * `ReferenceError: module is not defined`, turning every request into a 500. Same
 * failure `$lib/features/public-register/server.ts` exists for.
 *
 * Everything below is pure — no Svelte, no I/O.
 */
export {
	dispatchRespondSchema,
	isValidThaiNationalId,
	responseCodeSchema,
	ticketFindSchema,
	ticketStatusLabel,
	volunteerApplySchema
} from './domain/volunteer';
export type { TicketFindInput, VolunteerApplyInput } from './domain/volunteer';

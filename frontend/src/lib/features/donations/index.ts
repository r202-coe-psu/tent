// Domain — documents
export type { DonationPreDeclaration } from './domain/donation';
export type { PublicDonationDoc, PublicDonor, ScanDonationView } from './domain/public-donation';
export { receiveDonationInputSchema, publicDonationErrorMessage } from './domain/public-donation';

// Domain — shared PURE computation (needs board + POST donations). Server-side
// doc fetching lives in $lib/server/donation-docs (kept out of the client barrel).
export { computeNeeds } from './domain/compute-needs';

// Donation lifecycle transition used by the reservation TTL job (T-21). Re-exported
// here because the operations barrel also exports Svelte UI and is therefore not
// import-safe from server endpoints; this donations barrel stays UI-free.
export { expireDonation } from '$lib/features/operations/domain/operations';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	PUBLIC_DONATION_CATEGORIES
} from './domain/donation';

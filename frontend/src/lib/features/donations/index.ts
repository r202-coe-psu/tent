// Domain — documents
export type { DonationPreDeclaration } from './domain/donation';
export type { PublicDonationDoc, PublicDonor, ScanDonationView } from './domain/public-donation';

// Domain — shared PURE computation (needs board + POST donations). Server-side
// doc fetching lives in $lib/server/donation-docs (kept out of the client barrel).
export { computeNeeds } from './domain/compute-needs';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	PUBLIC_DONATION_CATEGORIES
} from './domain/donation';

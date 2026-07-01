// Domain — documents
export type { DonationPreDeclaration } from './domain/donation';
export type { PublicDonationDoc, PublicDonor } from './domain/public-donation';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	PUBLIC_DONATION_CATEGORIES
} from './domain/donation';

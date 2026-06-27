// Domain — documents
export type { DonationPreDeclaration, DonationIntakeInput } from './domain/donation';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	receiveDonation
} from './domain/donation';
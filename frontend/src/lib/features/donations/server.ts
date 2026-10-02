/**
 * Server-safe entry point for the donations feature.
 *
 * Keeps the domain logic BFF endpoints need (`api/public/v1/donations/**`,
 * `api/back-office/donations/**`) reachable without the main barrel's data/application/UI
 * exports, whose import graph reaches browser-only packages such as `qrcode`.
 */

export { receiveDonationInputSchema, isDonorEditable } from './domain/public-donation';
export type { PublicDonationDoc, ScanDonationView } from './domain/public-donation';
export { walkInIntakeInputSchema } from './domain/back-office';
export type { PendingDonationRow } from './domain/back-office';
export {
	createDonationRedirect,
	donationRedirectInputSchema,
	isDonationRedirect
} from './domain/donation-redirect';
export type { DonationRedirect } from './domain/donation-redirect';
export { computeNeeds, pickCampaignForItems } from './domain/compute-needs';
export { carryItemIds } from './domain/carry-item-ids';
export {
	computeSlotAvailability,
	slotAvailabilityFor,
	slotModeForDelivery
} from './domain/compute-slots';
export { donationPreDeclarationInputSchema } from './domain/donation';

// Domain — documents
export type { DonationPreDeclaration } from './domain/donation';
export type { PublicDonationDoc, PublicDonor, ScanDonationView } from './domain/public-donation';
export {
	receiveDonationInputSchema,
	publicDonationErrorMessage,
	isDonorEditable
} from './domain/public-donation';
export type { ReceiveDonationInput } from './domain/public-donation';

// Domain — public tracking ticket (DN-6)
export type {
	DonationTrackView,
	DonationTrackStatus,
	DonationTrackItem,
	DonationTrackLogistics,
	DonationTrackDonor
} from './domain/tracking';
export {
	toDonationTrackView,
	donationStatusLabel,
	deliveryMethodLabel,
	vehicleLabel,
	formatTrackTimestamp,
	formatTrackSchedule,
	canCancelDonation,
	canEditCourierTracking,
	isTerminalDonationStatus
} from './domain/tracking';

// Domain — shared PURE computation (needs board + POST donations). Server-side
// doc fetching lives in $lib/server/donation-docs (kept out of the client barrel).
export { computeNeeds } from './domain/compute-needs';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	PUBLIC_DONATION_CATEGORIES
} from './domain/donation';

// Data + application — public tracking (BFF, not publicClient)
export {
	cancelDonation,
	fetchDonationTracking,
	searchDonationTracking,
	updateCourierTracking
} from './data/public-tracking';
export {
	donationTrackingKeys,
	useCancelDonation,
	useDonationTracking,
	useDonationTrackSearch,
	useUpdateCourierTracking
} from './application/queries';

// UI
export { default as CancelDonationDialog } from './ui/cancel-donation-dialog.svelte';

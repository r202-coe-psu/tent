// Domain — documents
export type { DonationPreDeclaration } from './domain/donation';
export type {
	DonationRevision,
	PublicDonationDoc,
	PublicDonor,
	ScanDonationView
} from './domain/public-donation';
export {
	receiveDonationInputSchema,
	publicDonationErrorMessage,
	isDonorEditable
} from './domain/public-donation';
export type { ReceiveDonationInput } from './domain/public-donation';
export type { PendingDonationRow } from './domain/back-office';

// Domain — redirect ticket (R-16.4 · CR-087)
export type { DonationRedirect, DonationRedirectInput } from './domain/donation-redirect';
export {
	createDonationRedirect,
	donationRedirectInputSchema,
	donationRedirectDocSchema,
	isDonationRedirect
} from './domain/donation-redirect';

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
export {
	computeNeeds,
	pickCampaignForItems,
	type CampaignPick,
	type RequestedItem
} from './domain/compute-needs';
export { carryItemIds, type BareItem } from './domain/carry-item-ids';

// Domain — drop-off verification lot numbering (CR-052 §1.2)
export { generateLotNo, formatLotNote } from './domain/lot';

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
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
} from './data/public-tracking';
export {
	donationTrackingKeys,
	useCancelDonation,
	useDonationTracking,
	useDonationTrackSearch,
	useUpdateCourierTracking,
	useUpdateDonationItems
} from './application/queries';

// Data + application — back-office intake queue (BFF, admin-credentialed route)
export {
	fetchDonationsByStatus,
	fetchDonationDetail,
	receiveDonationCount,
	type BackOfficeDonationRow,
	type BackOfficeDonationDetail,
	type CountedLineInput
} from './data/back-office-donations';
export {
	backOfficeDonationKeys,
	useDonationQueue,
	useBackOfficeDonation,
	useReceiveDonationCount
} from './application/queries';

// UI
export { default as CancelDonationDialog } from './ui/cancel-donation-dialog.svelte';
export { default as EditDonationItemsDialog } from './ui/edit-donation-items-dialog.svelte';

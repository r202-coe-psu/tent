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
	buildReceivedFindBody,
	isAllowedDonationStatus,
	RECEIVED_BOOKMARK_MAX_LENGTH,
	RECEIVED_PAGE_SIZE
} from './domain/donation-queue';
export { maskDonorEmail, maskDonorName, maskDonorPhone } from './domain/donor-contact';
export {
	buildBookingRefFindBody,
	buildLotLedgerFindBody,
	buildPhoneFindBody,
	buildReceivedViewQuery,
	decodeSearchCursor,
	DONATION_RECEIVED_VIEWS,
	encodeSearchCursor,
	LOT_LEDGER_PAGE_SIZE,
	normalizeSearchQuery,
	pageLotMatches,
	receivedSearchInputSchema
} from './domain/received-search';
export type {
	ReceivedSearchBy,
	ReceivedSearchErrorCode,
	SearchCursorState
} from './domain/received-search';
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
	DEFAULT_SLOT_WINDOWS,
	slotAvailabilityFor,
	slotModeForDelivery
} from './domain/compute-slots';
export { donationPreDeclarationInputSchema } from './domain/donation';
export {
	combineLineRejectReasons,
	donorRejectMessage,
	rejectDonationInputSchema
} from './domain/reject-reason';
export type { DonationRejectReasonCode } from './domain/reject-reason';
export {
	applyLineReview,
	donationStatusFromLines,
	hasLineReview,
	rejectRemainingLines,
	reviewDonationInputSchema
} from './domain/item-review';
export type { LineReviewResult } from './domain/item-review';

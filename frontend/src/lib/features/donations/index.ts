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
	isDonorEditable,
	donationItemEditGate,
	donationPayloadUnit,
	buildDonationItemsPayload,
	donorUnitOptions,
	linesMissingExpiry
} from './domain/public-donation';
export type {
	DonationItemEditGate,
	DonationPayloadLine,
	DonationUnitSource,
	ExpiryCheckLine
} from './domain/public-donation';
export type { ReceiveDonationInput } from './domain/public-donation';
export type { PendingDonationRow, WalkInIntakeInput } from './domain/back-office';
export { walkInIntakeInputSchema, donationActionRef, donationRefLabel } from './domain/back-office';

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
	DonationTrackDonor,
	DonationTrackPointReceipt,
	DonationLookupItem
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
	isTerminalDonationStatus,
	isStartedAtPoint,
	closedAtIntakeMessage,
	lookupItemSchedule,
	maskLookupPhone,
	rejectedLineReasons
} from './domain/tracking';
// Domain — drop-off destination (#590)
export type {
	DonationPointSource,
	DropOffGeo,
	DropOffPoint,
	DropOffShelterSource
} from './domain/drop-off';
export {
	dropOffDirectionsUrl,
	listDropOffPoints,
	needsDropOffDestination,
	resolveDropOffPoint
} from './domain/drop-off';
// Domain — drop-off point per line (CR-206)
export type {
	BookablePoint,
	DropOffDestinationGroup,
	DropOffGroupStatus
} from './domain/line-points';
export {
	ANY_POINT_KEY,
	bookableDropOffPoints,
	currentDropOffPointIds,
	defaultDropOffPointId,
	ALL_LINES_PICKER,
	groupDropOffDestinations,
	hasLinePoints,
	lineDestinationResolver,
	lineDropOffPointId,
	withCurrentLinePoints
} from './domain/line-points';
// Domain — box label (#591)
export type {
	BoxLabel,
	BoxLabelLine,
	BoxLabelSource,
	BoxLabelSourceItem
} from './domain/box-label';
export {
	BOX_LABEL_MAX_LINES,
	BOX_LABEL_MM,
	boxLabelPageCss,
	buildBoxLabels,
	canPrintBoxLabel,
	clipLabelLines
} from './domain/box-label';
// Domain — back-office booking list (#617)
export {
	DONATION_QUEUE_FILTERS,
	filterDonationQueue,
	filterForLegacyTab,
	parseQueueFilter,
	queueGroupOf
} from './domain/donation-queue';
export type { DonationQueueFilter } from './domain/donation-queue';
// Domain — per-line review (CR-174)
export {
	donationStatusFromLines,
	hasLineReview,
	isAutoApprovedLine,
	lineReviewDecisionSchema
} from './domain/item-review';
export type {
	ItemReviewStatus,
	LineReviewDecision,
	ReviewDonationInput
} from './domain/item-review';

// Domain — receiving point by point (CR-206)
export {
	allLinesRecorded,
	closeDonationByPoints,
	currentLinePoint,
	hasPointReceipts,
	isReceivedByPoint,
	recordedLineNos,
	type DonationCloseResult
} from './domain/point-receipts';
export {
	ANY_DROP_OFF_POINT_LABEL,
	canCloseByPoints,
	defaultStoragePointId,
	hasOtherPointLines,
	linePointLabel,
	namesDropOffPoints,
	pointReceiptFields,
	recordedAtLabel,
	scanLineStates,
	scanReceiveMode,
	type NamedPoint,
	type ScanLineState,
	type ScanReceiveMode
} from './domain/point-scan';
// Domain — reject reasons (CR-172)
export {
	DONATION_REJECT_REASON_CODES,
	DONATION_REJECT_REASON_LABELS,
	REJECT_NOTE_MAX,
	donorRejectMessage,
	rejectDonationInputSchema
} from './domain/reject-reason';
export type { DonationRejectReasonCode, RejectDonationInput } from './domain/reject-reason';

// Domain — shared PURE computation (needs board + POST donations). Server-side
// doc fetching lives in $lib/server/donation-docs (kept out of the client barrel).
export {
	computeNeeds,
	pickCampaignForItems,
	type CampaignPick,
	type RequestedItem
} from './domain/compute-needs';
export { carryItemIds, type BareItem } from './domain/carry-item-ids';
export { receivedQtyDifference, type ReceiveLineQty } from './domain/receive-line';

// Domain — queue slots (DN-5 · schema.md §2.13)
export {
	computeSlotAvailability,
	slotAvailabilityFor,
	slotBookedCount,
	slotLabel,
	slotModeForDelivery,
	DEFAULT_SLOT_WINDOWS,
	type SlotAvailability,
	type SlotBooking,
	type SlotStatus
} from './domain/compute-slots';

// Domain — input schemas + factories + transitions + guards
export {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	donorCategoryFromCatalog,
	PUBLIC_DONATION_CATEGORIES
} from './domain/donation';

// Data + application — public tracking (BFF, not publicClient)
export { fetchShelterNeeds, type PublicShelterNeed } from './data/public-needs';
export { fetchDonationSlots } from './data/public-slots';
export {
	cancelDonation,
	fetchDonationTracking,
	lookupDonationsByPhone,
	searchDonationTracking,
	DonationLookupError,
	type DonationLookupErrorCode,
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
} from './data/public-tracking';
export {
	donationTrackingKeys,
	usePublicShelterNeeds,
	useDonationSlots,
	useCancelDonation,
	useDonationTracking,
	useDonationTrackSearch,
	useDonationPhoneLookup,
	useUpdateCourierTracking,
	useUpdateDonationItems,
	donationQueueKeys,
	useDonationQueue
} from './application/queries';

// Donor photos (CR-175 donor photos)
export {
	DONATION_PHOTO_MAX_COUNT,
	DONATION_PHOTOS_MAX_TOTAL_BYTES,
	type DonorPhoto
} from './domain/donation-photos';
export { DonorPhotos, type DonorPhotoRefusal } from './application/donor-photos.svelte';

// UI
export { default as DonorPhotoPicker } from './ui/donor-photo-picker.svelte';
export { default as DonationPhotoStrip } from './ui/donation-photo-strip.svelte';
export { default as CancelDonationDialog } from './ui/cancel-donation-dialog.svelte';
export { default as RejectDonationDialog } from './ui/reject-donation-dialog.svelte';
export { default as RejectReasonFields } from './ui/reject-reason-fields.svelte';
export { default as DropOffCard } from './ui/drop-off-card.svelte';
export { default as DropOffGroups } from './ui/drop-off-groups.svelte';
export { default as DropOffPointsSection } from './ui/drop-off-points-section.svelte';
export { default as BoxLabelSheet } from './ui/box-label-sheet.svelte';
export { default as LineDecisionToggle } from './ui/line-decision-toggle.svelte';
export { default as EditDonationItemsDialog } from './ui/edit-donation-items-dialog.svelte';

/**
 * Public API of the `people` feature (FR-4..13 registration baseline).
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — documents
export type {
	Evacuee,
	Medical,
	Household,
	Movement,
	Screening,
	PeopleDoc,
	CurrentStay,
	EmergencyContact,
	PetGroup,
	HouseholdVehicle,
	HouseholdAsset,
	MovementDestination,
	Gender,
	Religion,
	StayStatus,
	HouseholdStatus,
	MovementAction,
	CareTrack,
	TriageLevel,
	BloodGroup,
	CardType,
	CardSnapshot,
	HousingType
} from './domain/people';

// Domain — vulnerability marker (printed QR card)
export { vulnerabilityMarker } from '$lib/utils/vulnerability-marker';
export type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';
export { isQrCardStale } from './domain/qr-card-staleness';

// Domain — input schemas + factories + transitions + guards
export {
	CARD_NUMBER_MAX_LENGTH,
	cardNumberMaxLength,
	cardNumberEffectiveLength,
	clampCardNumber,
	mintAnonymousId,
	isAnonymousId,
	replacePersonId,
	migrateVulnerableGroupCode,
	migrateVulnerableGroupCodes,
	admissionSupportsVulnerableGroup,
	mergeVulnerableGroupsAndSpecialNeeds,
	housingTypeSchema,
	migrateHouseholdToV5,
	migratePetGroup,
	migratePetGroups,
	isMeaningfulOtherPetNotes,
	petSpeciesLabel,
	groupPetsBySpecies,
	genderSchema,
	genderLabelTh,
	genderLabel,
	peopleLabels,
	peopleLabelsByLanguage,
	religionSchema,
	stayStatusSchema,
	STATUS_LABELS,
	householdStatusSchema,
	movementActionSchema,
	careTrackSchema,
	triageLevelSchema,
	bloodGroupSchema,
	cardSnapshotSchema,
	evacueeInputSchema,
	medicalInputSchema,
	householdInputSchema,
	evacueePersonalEditFormSchema,
	evacueeEmergencyEditFormSchema,
	evacueeAddressEditFormSchema,
	evacueeHealthEditFormSchema,
	evacueeHouseholdEditFormSchema,
	evacueeAssetsEditFormSchema,
	movementInputSchema,
	screeningInputSchema,
	createEvacuee,
	createDraftEvacueeFromCard,
	createKioskEvacueeFromCard,
	createKioskWalkInHousehold,
	createMedical,
	createHousehold,
	createMovement,
	createScreening,
	assertMovementAllowed,
	movementConflictMessage,
	canCheckInEvacuee,
	canScanCheckIn,
	needsIntakeBeforeStay,
	SCAN_RETURN_STATUSES,
	canCheckOutEvacuee,
	canChangeEvacueeZone,
	canConfirmRoom,
	canCancelEvacueePreRegistration,
	canCancelHouseholdPreRegistration,
	isPendingZoneArrivalConfirmation,
	listPendingZoneArrivalConfirmations,
	CHECK_IN_ELIGIBLE_STATUSES,
	CHECK_OUT_ELIGIBLE_STATUSES,
	SHELTER_CLOSE_CHECKOUT_STATUSES,
	SHELTER_CLOSE_CANCEL_STATUSES,
	SHELTER_CLOSE_AFFECTED_STATUSES,
	SHELTER_CLOSED_REASON,
	SHELTER_CLOSED_REASON_LABEL,
	SHELTER_CLOSED_REASON_LABEL_EN,
	movementReasonLabel,
	type CheckoutDestinationType,
	CONFIRM_ROOM_ELIGIBLE_STATUSES,
	ZONE_CHANGE_ELIGIBLE_STATUSES,
	ACTIVE_HOUSEHOLD_STATUSES,
	HOUSEHOLD_STATUS_TRANSITIONS,
	MANUAL_HOUSEHOLD_STATUS_TRANSITIONS,
	isActiveHouseholdStatus,
	checkEvacueeHouseholdConflict,
	assertEvacueeHouseholdAssignment,
	deriveHouseholdStatus,
	assertHouseholdStatusTransition,
	assertCheckoutDestination,
	applyMovementToStay,
	resolveStatusChangeAction,
	normalizeCheckoutRemark,
	statusChangeHandlerKind,
	maskNationalId,
	collectMemberRuleIssues,
	type MemberRuleIssue,
	type PeopleLabelSet,
	formatPersonName,
	matchesEvacueePhoneSearch,
	matchesEvacueeSearch,
	zoneLabel,
	stayZoneName,
	labelZoneName,
	type ZoneLabelSource,
	evacueeAgeYears,
	EWAR_SYMPTOM_GROUPS,
	EWAR_SYMPTOM_GROUPS_EN,
	ewarSymptomGroupsByLanguage,
	ewarSymptomLabel,
	isEvacuee,
	isMedical,
	isHousehold,
	isMovement,
	isScreening,
	type EvacueeInput,
	type MedicalInput,
	type HouseholdInput,
	type MovementInput,
	type ScreeningInput
} from './domain/people';

export {
	CR112_HOUSING_TYPE_CODES,
	DEFAULT_HOUSING_TYPE_ITEMS_TH,
	buildHousingTypeSelectItems,
	setHousingTypeFromSelect,
	housingTypeLabelForCode,
	DEFAULT_HOUSING_TYPE_ITEMS_EN,
	defaultHousingTypeItems,
	type HousingTypeSelectItem,
	type MasterHousingItem
} from './domain/housing-type-ui';

export { startStaffStationVisit } from './application/station-log';

export {
	STATION_LOG_STALE_WINDOW_MS,
	STATION_LOG_WRITE_WARNING,
	STATION_NUMBERS,
	createStationLog,
	hasOpenStationStart,
	stationLogInputSchema,
	type StationLog,
	type StationLogInput,
	type StationLogAction,
	type StationLogChannel,
	type StationNumber
} from './domain/station-log';

export {
	nextQueueLabel,
	classifyZoningQueueTab,
	classifyScreeningQueueTab,
	countStationQueues,
	nextScreeningQueueEvacuee,
	recommendZoneKind,
	pickRecommendedZone,
	resolvePreferredZone,
	ZONE_KIND_LABELS,
	zoneKindLabelsByLanguage,
	nextQueueLabelText,
	nextQueueLabelsEn,
	countPresentOccupantsByZone,
	parseZoningQrCode,
	buildZoningPath,
	isInShelterStatus,
	intakeStationsPassed,
	zoningQueueSince,
	sortByZoningQueueSince,
	formatQueueWait,
	type NextQueueLabel,
	type StationQueueCounts,
	type ZoningQueueTab,
	type ScreeningQueueTab,
	type ZoningRecommendKind,
	type PreferredZoneOutcome
} from './domain/intake-pipeline';

export {
	buildEvacueeQrLabel,
	EVACUEE_QR_PLACEHOLDER_PAYLOAD,
	type EvacueeQrLabel,
	type EvacueeQrLabelInput
} from './domain/evacuee-qr-label';

export {
	checkPersonQr,
	staffPersonQrRejectionMessage,
	type EvacueeQrPrintsReader
} from './application/evacuee-qr-check';
export { issueQrPayloads, type IssuedQrPayloads } from './application/evacuee-qr-issue';
export { readEvacueeQrPrints } from './data/evacuee-qr.remote';
export { useEvacueeQrPrints } from './application/evacuee-qr-prints';

export {
	extractScanLookupToken,
	extractScanPersonQr,
	toCouchEvacueeId,
	mongoUnassignedSearchQueries,
	pickUnassignedSearchHit
} from './domain/scan-lookup';

export {
	toggleId,
	selectRange,
	applyRowClickSelection,
	type ApplyRowClickSelectionInput,
	type ApplyRowClickSelectionResult
} from './domain/row-selection';

export {
	EVACUEE_SORTS,
	EVACUEE_SORT_LABELS,
	DEFAULT_EVACUEE_SORT,
	isEvacueeSort,
	sortEvacuees,
	type EvacueeSort
} from './domain/evacuee-sort';

export {
	REPORT_IN_CTA_LABEL,
	NEW_REGISTRATION_CTA_LABEL,
	INTAKE_SEARCH_PLACEHOLDER,
	OVERRIDE_NEW_REG_TITLE,
	OVERRIDE_NEW_REG_BODY,
	OVERRIDE_NEW_REG_POOL_ERROR_BODY,
	OVERRIDE_NEW_REG_CONFIRM,
	OVERRIDE_NEW_REG_CANCEL,
	POOL_VERIFY_ERROR_COPY,
	NEW_REG_LOCKED_HINT,
	NEW_REG_POOL_ERROR_LOCKED_HINT,
	NEW_REG_OVERRIDE_TRIGGER_LABEL,
	POOL_CLAIM_FORBIDDEN_HINT,
	intakeSearchCopyByLanguage,
	resolveShelterHitAction,
	shelterHitStatusLabel,
	hasFederatedIntakeHits,
	isIntakeNewRegistrationLocked,
	resolveNewRegistrationCta,
	deriveDuplicateCheckQuery,
	deriveDuplicateCheckQueries,
	duplicateCheckKey,
	type DuplicateCheckQuery,
	type ShelterHitAction,
	type IntakeSearchCopy,
	type NewRegistrationCtaKind,
	type DuplicateCheckMember
} from './domain/intake-search';

export {
	sectionEVisibility,
	resolveHouseholdLeave,
	autoHouseholdLabel,
	hasMinimumResidence,
	defaultHouseholdChoice,
	isLeavingLinkedHousehold,
	matchesResidenceAddress,
	normThaiAddressText,
	suggestHouseholdsByResidence,
	suggestHouseholdsByPhone,
	isJoinableHouseholdStatus,
	filterJoinCandidatesByEvacueeQuery,
	type SectionEFlags,
	type SectionEExistingData,
	type SectionEVisibility,
	type HouseholdLeaveInput,
	type HouseholdLeaveResult,
	type HouseholdChoice,
	type ResidenceFields,
	type ResidenceMatchCandidate,
	type PhoneHouseholdMatchCandidate,
	type JoinCandidateEvacuee
} from './domain/registration-shell';
export { localizeRegistrationMessage } from './domain/registration-messages.i18n';

export {
	PRIMARY_CONTACT_LABEL,
	PRIMARY_CONTACT_LABEL_EN,
	blankUnifiedMember,
	applyAnonymousIdToMember,
	memberCardLabel,
	parseUnifiedRegistration,
	planFamilyRegistration,
	togglePetSpecies,
	householdToUnifiedInput,
	evacueeToUnifiedMember,
	unifiedRegistrationInputSchema,
	unifiedMemberInputSchema,
	unifiedHouseholdInputSchema,
	type UnifiedRegistrationChannel,
	type UnifiedMemberInput,
	type UnifiedMemberWithMeta,
	type UnifiedHouseholdInput,
	type UnifiedRegistrationInput,
	type FamilyRegistrationPlan,
	type FamilyRegistrationMode,
	type FamilyReportInPayload,
	type MemberPhotoUploadMode,
	type RegistrationConsent,
	type RegistrationConsentConfig
} from './domain/unified-registration';

export { PUBLIC_PRE_REGISTER_DRAFT_KEY } from './domain/registration-draft';

export {
	defaultBirthCalendar,
	toDisplayBirthYear,
	toPersistBirthYearBE,
	ageFromBirthYearBE,
	currentYearBE,
	type BirthCalendar
} from './domain/birth-calendar';

export type { PeopleRepository, EvacueeFilters, HouseholdFilters } from './data/people.repository';
export { peopleRepository, isRegistrationCompensationIncomplete } from './data/people.remote';
export type { EvacueeNameRecord } from './data/evacuee-names.remote';
export { getShelterCode, getShelterDb } from '$lib/db/shelter';

// Application — TanStack Query hooks + changes-feed live-query wiring
export {
	peopleKeys,
	useEvacuees,
	useEvacueeNames,
	useEvacuee,
	usePendingScreeningEvacuees,
	useEvacueesPaginated,
	useSearchEvacuees,
	useCreateEvacuee,
	useCreateFamilyRegistration,
	useSubmitFamilyReportIn,
	useMergeHouseholds,
	usePromoteReportIn,
	useUpdateEvacuee,
	useCheckInEvacuee,
	useCheckOutEvacuee,
	useConfirmRoom,
	useConfirmRoomForHousehold,
	useChangeEvacueeZone,
	useRecordMovement,
	lookupEvacueeByScanCode,
	lookupFederatedByScanCode,
	lookupFederatedByScanCodeWithDeps,
	type FederatedScanHit,
	type FederatedScanCouchHit,
	type FederatedScanUnassignedHit,
	type FederatedScanRejectedHit,
	type FederatedScanLookupDeps,
	useHouseholds,
	useHousehold,
	useHouseholdMembers,
	useHouseholdsPaginated,
	listMatchingEvacueeIds,
	listMatchingHouseholdIds,
	listCancellableEvacueeIds,
	listCancellableHouseholdIds,
	useCreateHousehold,
	useUpdateHousehold,
	usePatchHousehold,
	useCancelPreRegistration,
	useCancelEvacueePreRegistration,
	useCreateMedical,
	useCreateScreening,
	useRecordMedicalScreening,
	useCreateEvacueeWithScreening,
	useUpdateMedical,
	usePatchMedical,
	useDeleteMedical,
	usePatchEvacuee,
	useSetSearchVisibility,
	useMedicals,
	useMedicalByEvacuee,
	useMovements,
	useMovementsByEvacuee,
	useScreenings,
	useScreeningsByEvacuee,
	startPeopleLiveQuery
} from './application/queries';

// UI — feature components
export {
	default as StayStatusBadge,
	STAY_STATUS_BADGE_STYLES
} from './ui/shared/stay-status-badge.svelte';
export {
	default as RegisteredViaBadge,
	REGISTERED_VIA_BADGE_STYLES,
	type RegisteredViaStyle
} from './ui/shared/registered-via-badge.svelte';
export { default as Station1IntakeSearch } from './ui/search-scan/station1-intake-search.svelte';
export { default as Station1EvacueeQueue } from './ui/search-scan/evacuee-queue-view.svelte';
export {
	goToEvacueeReportIn,
	goToEvacueeProfile,
	openEvacueeRow
} from './ui/search-scan/evacuee-queue-navigation';
export { default as EvacueeProfileView } from './ui/evacuee-profile/evacuee-profile-view.svelte';
export { default as RegistrationShell } from './ui/registration/registration-shell.svelte';
export { default as EvacueeList } from './ui/search-scan/evacuee-list.svelte';
export { default as HouseholdForm } from './ui/household-form/household-form.svelte';
export { default as HouseholdFormPage } from './ui/household-form/household-form-page.svelte';
export { default as HouseholdPostArrival } from './ui/household-flows/household-post-arrival.svelte';
export { default as EvacueeWristbandSuccess } from './ui/registration/evacuee-wristband-success.svelte';
export { default as RegistrationConsentResult } from './ui/registration/registration-consent-result.svelte';
export {
	default as FamilyBatchPrint,
	type IntakeNextStation
} from './ui/registration/family-batch-print.svelte';
export {
	default as StationCompletionSummary,
	type StationSummaryFact
} from './ui/shared/station-completion-summary.svelte';
export { default as UnifiedRegistrationForm } from './ui/registration/unified-registration-form.svelte';
export type { ThaiDAutofillProfile, ThaiDAutofillAddress } from './domain/thaid-profile';
export { stripThaiTitle } from './domain/thaid-profile';
export {
	scannerCardSchema,
	scannerCardPhotoSchema,
	cardToUnifiedMember,
	applyScannedCard,
	digitsOnly,
	type ScannerCard,
	type ScannerCardPhoto,
	type ScannedCardPlacement,
	type ScannedCardDuplicate
} from './domain/scanner-card';
export { default as ThaidActionButton } from './ui/registration/thaid-action-button.svelte';
export { default as ThaidMemberScanDialog } from './ui/registration/thaid-member-scan-dialog.svelte';
export { default as UnifiedRegistrationSummaryCard } from './ui/registration/unified-registration-summary-card.svelte';
export { default as UnifiedRegistrationStepper } from './ui/registration/unified-registration-stepper.svelte';
export { default as PullPreRegisteredDialog } from './ui/registration/pull-pre-registered-dialog.svelte';
export {
	default as EvacueeHandoverSlipModal,
	buildScreeningDeepLink
} from './ui/evacuee-profile/evacuee-handover-slip-modal.svelte';
export { default as ScanCheckInOutPage } from './ui/search-scan/scan-check-in-out-page.svelte';
export { default as EvacueeSearchEditPage } from './ui/search-scan/evacuee-search-edit-page.svelte';
export { default as EvacueeSearchResultsPage } from './ui/search-scan/evacuee-search-results-page.svelte';
export { default as EvacueePetAssetVehicle } from './ui/household-flows/evacuee-pet-asset-vehicle.svelte';
export { default as HouseholdPreRegister } from './ui/household-flows/household-pre-register.svelte';
export { default as HouseholdPreRegisterSummary } from './ui/household-flows/household-pre-register-summary.svelte';
export { default as HouseholdProfileView } from './ui/household-profile/household-profile-view.svelte';
export { default as RegistrationSaveErrorAlert } from './ui/registration/registration-save-error-alert.svelte';
export {
	buildSaveFailureReport,
	formatSaveFailureReport,
	type SaveFailureReport
} from '$lib/utils/errors';
export {
	isValidThaiIdCandidate,
	performFederatedDuplicateLookup,
	resolveInstantDuplicateAction,
	type InstantDuplicateMatch,
	type FederatedDuplicateLookupDeps
} from './domain/instant-duplicate';
export { default as InstantDuplicateDialog } from './ui/registration/instant-duplicate-dialog.svelte';

// UI — i18n dictionaries used directly by route pages
export { EVACUEE_PAGE_I18N, type EvacueePageI18n } from './ui/_constants/evacuee-page.i18n';
export { EVACUEE_PROFILE_I18N } from './ui/_constants/evacuee-profile.i18n';
export { EVACUEE_SEARCH_I18N, type EvacueeSearchI18n } from './ui/_constants/evacuee-search.i18n';

// UI — shared sub-form components (Issue #205)
export {
	PersonalInfoFields,
	SpecialNeedsFields,
	SPECIAL_NEEDS_COMMON_TAGS,
	VulnerableGroupsFields,
	EmergencyContactFields,
	EwarSymptomsFields,
	HouseholdAddressFields,
	PetAssetVehicleFields,
	PetQuickSelect,
	HealthMedicalFields,
	ZoneSelectionFields,
	type SpecialNeedTag,
	type ZoneItem
} from './ui/forms/index.js';

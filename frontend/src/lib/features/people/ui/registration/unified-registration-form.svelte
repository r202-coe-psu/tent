<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Users from '@lucide/svelte/icons/users';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { onMount, tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import {
		matchResidence,
		type ResidenceMatchChip
	} from '$lib/features/public-register/data/public-register.api';
	import { Input } from '$lib/components/ui/input/index.js';
	import HouseholdAddressFields from '../forms/household-address-fields.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import UnifiedRegistrationStickyNav from './unified-registration-sticky-nav.svelte';
	import UnifiedRegistrationSubmitBar from './unified-registration-submit-bar.svelte';
	import UnifiedRegistrationPetsSection from './unified-registration-pets-section.svelte';
	import UnifiedRegistrationVehiclesSection from './unified-registration-vehicles-section.svelte';
	import UnifiedRegistrationMembersSection from './unified-registration-members-section.svelte';
	import UnifiedRegistrationSummaryCard from './unified-registration-summary-card.svelte';
	import UnifiedRegistrationStepper from './unified-registration-stepper.svelte';
	import ThaidActionButton from './thaid-action-button.svelte';
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';
	import { fetchThaidRegistrationStatus } from '$lib/api/thaid-status';
	import { readRegistrationStickyTopPx } from './registration-sticky-offset';
	import { firstInvalidField, focusTargetFor } from './registration-focus';
	import {
		applyIntersectionEntries,
		isScrollNearEnd,
		pickActiveSectionId
	} from './registration-scroll-spy';
	import {
		parseInitialPets,
		syncPetsToHousehold,
		type PetCardItem
	} from './unified-registration-pets';
	import {
		blankUnifiedMember,
		membersMissingPhoneChoice,
		unifiedRegistrationInputSchema,
		type MemberPhotoUploadMode,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput,
		type UnifiedHouseholdInput
	} from '../../domain/unified-registration';
	import {
		collectMemberRuleIssues,
		dormFieldsFor,
		formatPersonName,
		type HousingType,
		type HouseholdVehicle,
		type PetGroup
	} from '../../domain/people';
	import {
		stillInvalidEntries,
		toRegistrationEntries,
		toRegistrationFieldErrors,
		type RegistrationErrorEntry,
		type RegistrationIssue
	} from '../../domain/registration-validation';
	import { normalizeThaiPhone, sanitizePhoneTyping } from '$lib/db/model';
	import {
		hasMinimumResidence,
		suggestHouseholdsByPhone,
		type ResidenceFields,
		type ResidenceMatchCandidate,
		type PhoneHouseholdMatchCandidate
	} from '../../domain/registration-shell';
	import {
		peopleKeys,
		useEvacuees,
		useHouseholds,
		useSearchEvacuees
	} from '../../application/queries';
	import { peopleRepository } from '../../data/people.remote';
	import {
		readResidenceSuggestDeps,
		residenceSuggestTick
	} from './residence-suggest-reactivity.svelte';
	import { createQuery } from '@tanstack/svelte-query';

	type FormSectionId = 'address' | 'pets' | 'vehicles' | 'members';

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	let {
		channel = 'onsite',
		mode = 'create',
		initialHousehold = null,
		initialMembers = null,
		pending = false,
		submitDisabled = false,
		/** Fully read-only display: blocks all interaction and hides the submit bar. */
		readOnly = false,
		submitLabel,
		submitAlign = 'right',
		stickyTopOffset,
		includeVehiclesAssets,
		enableUnassignedPhoto = false,
		allowHouseholdJoin = false,
		shelterCode = '',
		shelterName = '',
		initialThaidProfile = null,
		onsubmit,
		onselectshelter,
		onDirtyChange,
		/** Increment from parent to clear a stale public join selection (bad token / missing target). */
		joinResetKey = 0,
		/** Shelter codes that accept public pre-registration (fallback when chip lacks the flag). */
		bookableShelterCodes = [],
		children
	}: {
		channel?: UnifiedRegistrationChannel;
		mode?: 'create' | 'report-in';
		initialHousehold?: UnifiedHouseholdInput | null;
		initialMembers?: UnifiedMemberWithMeta[] | null;
		pending?: boolean;
		/** Disable the confirm button without locking fields or showing submit spinner. */
		submitDisabled?: boolean;
		/** Fully read-only display: blocks all interaction and hides the submit bar. */
		readOnly?: boolean;
		submitLabel?: string;
		submitAlign?: 'right' | 'center';
		stickyTopOffset?: string;
		includeVehiclesAssets?: boolean;
		enableUnassignedPhoto?: boolean;
		/** Report-in flows with no household must explicitly join or create. */
		allowHouseholdJoin?: boolean;
		shelterCode?: string;
		shelterName?: string;
		initialThaidProfile?: ThaiDAutofillProfile | null;
		onsubmit: (
			input: UnifiedRegistrationInput,
			meta?: { reportingInMembers: UnifiedMemberWithMeta[]; allMembers: UnifiedMemberWithMeta[] }
		) => Promise<void> | void;
		onselectshelter?: (shelterCode: string, shelterName?: string) => void;
		onDirtyChange?: (dirty: boolean) => void;
		joinResetKey?: number;
		bookableShelterCodes?: string[];
		children?: import('svelte').Snippet<[{ household: UnifiedRegistrationInput['household'] }]>;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	/** Locks every field/control (pending submit OR explicit read-only view). */
	const fieldsLocked = $derived(pending || readOnly);
	const showVehiclesAssets = $derived(includeVehiclesAssets ?? channel === 'onsite');
	const formStickyStyle = $derived(
		stickyTopOffset ? `--registration-sticky-top: ${stickyTopOffset}` : undefined
	);
	const shelterPhotoEnabled = $derived(
		channel === 'public' && !enableUnassignedPhoto && Boolean(shelterCode.trim())
	);
	/** Onsite / public-shelter → Couch image; public unassigned → GridFS. */
	const showPetPhotoUpload = $derived(
		channel === 'onsite' || enableUnassignedPhoto || shelterPhotoEnabled
	);
	const memberPhotoUpload = $derived.by((): MemberPhotoUploadMode => {
		if (channel === 'public') return 'none';
		if (channel === 'onsite') return 'onsite-couch';
		if (enableUnassignedPhoto) return 'unassigned-gridfs';
		if (shelterPhotoEnabled) return 'shelter-couch';
		return 'none';
	});

	function buildInitialHousehold(): UnifiedRegistrationInput['household'] {
		if (initialHousehold) {
			return {
				housing_type: initialHousehold.housing_type ?? 'owned_house',
				residence_landmark: initialHousehold.residence_landmark ?? null,
				dorm_name: initialHousehold.dorm_name ?? null,
				dorm_building: initialHousehold.dorm_building ?? null,
				dorm_floor: initialHousehold.dorm_floor ?? null,
				dorm_room: initialHousehold.dorm_room ?? null,
				address_no: initialHousehold.address_no ?? '',
				village_no: initialHousehold.village_no ?? '',
				subdistrict: initialHousehold.subdistrict ?? '',
				district: initialHousehold.district ?? '',
				province: initialHousehold.province ?? '',
				postal_code: initialHousehold.postal_code ?? '',
				pets: (initialHousehold.pets ?? []) as PetGroup[],
				vehicles: (initialHousehold.vehicles ?? []) as HouseholdVehicle[],
				assets: initialHousehold.assets ?? null
			};
		}
		return {
			housing_type: 'owned_house',
			residence_landmark: null,
			// Keep defined — Svelte 5 rejects bind:x={undefined} when $bindable has a fallback.
			dorm_name: null,
			dorm_building: null,
			dorm_floor: null,
			dorm_room: null,
			address_no: '',
			village_no: '',
			subdistrict: '',
			district: '',
			province: '',
			postal_code: '',
			pets: [] as PetGroup[],
			vehicles: [] as HouseholdVehicle[],
			assets: null
		};
	}

	function buildInitialMembers(): UnifiedMemberWithMeta[] {
		if (initialMembers && initialMembers.length > 0) {
			return initialMembers.map((m) => ({
				...blankUnifiedMember(),
				...m,
				// Keep defined — Svelte 5 rejects bind:x={undefined} when $bindable has a fallback.
				religion_other: m.religion_other ?? null,
				disability_other_detail: m.disability_other_detail ?? null,
				reporting_in: m.reporting_in ?? (m.stay_status === 'pre_registered' || !m._id)
			}));
		}
		return [blankUnifiedMember()];
	}

	let members = $state<UnifiedMemberWithMeta[]>(untrack(() => buildInitialMembers()));
	let household = $state<UnifiedRegistrationInput['household']>(
		untrack(() => buildInitialHousehold())
	);
	let assetDescription = $state(untrack(() => initialHousehold?.assets?.description ?? ''));
	/** Errors reported by the last failed submit; `null` until the first submit. */
	let submittedEntries = $state.raw<RegistrationErrorEntry[] | null>(null);
	/** Bumped on every failed submit — collapsed sections holding an error re-open on it. */
	let validationSeq = $state(0);
	/** Member card with the first error of the last failed submit (tab to show for large families). */
	let firstErrorMember = $state<number | null>(null);
	let formRootEl = $state<HTMLFormElement | null>(null);
	let touched = $state(false);
	let hasAutofilled = $state(false);
	let activeSection = $state<FormSectionId>('address');
	let scrollSpyPaused = $state(false);
	let isVirtualKeyboardOpen = $state(false);
	/** Mobile-only: summary sheet opened from chip near sticky CTA. */
	let mobileSummaryOpen = $state(false);

	const summaryPetCount = $derived(
		(household.pets ?? []).reduce((sum, p) => sum + (Number(p.count) || 1), 0)
	);
	const mobileSummaryChipLabel = $derived(
		`${t.memberLabel} ${members.length} · ${t.sectionPets} ${summaryPetCount}`
	);

	let petItems = $state<PetCardItem[]>(
		untrack(() => parseInitialPets(household.pets as PetGroup[]).items)
	);

	/** Create-path residence join — at most one of id (onsite) / token (public). */
	let joinHouseholdId = $state<string | null>(null);
	let joinMatchToken = $state<string | null>(null);
	let joinSelectedSummary = $state<string | null>(null);

	/** Quick search bar for member phone (household search enhancement). */
	let searchPhoneQuery = $state('');
	let searchPhoneTouched = $state(false);
	// CR-148 FR-11: inline error once the user leaves an incomplete / malformed number
	const searchPhoneError = $derived(
		searchPhoneTouched && searchPhoneQuery.trim() !== '' && !isThaiPhone(searchPhoneQuery)
			? t.familySearchPhoneInvalid
			: ''
	);

	function isThaiPhone(value: string): boolean {
		return /^0\d{8,9}$/.test(normalizeThaiPhone(value));
	}

	/** Currently selected match chip from public residence match (for address prefill & pets). */
	let selectedMatchChip = $state<ResidenceMatchChip | null>(null);

	let residenceSuggestTimer: ReturnType<typeof setTimeout> | null = null;
	let residenceSuggestions = $state<ResidenceMatchCandidate[]>([]);
	let publicMatchChips = $state<ResidenceMatchChip[]>([]);
	let residenceSuggestPending = $state(false);
	let residenceSuggestCheckedEmpty = $state(false);
	/** Public lookup request failed — not the same as "no family matched". */
	let residenceSuggestFailed = $state(false);
	/** Stay false until GET /api/public/v1/thaid/status confirms ON (public channel only). */
	let thaidEnabled = $state(false);

	const enableResidenceJoin = $derived(mode === 'create' || allowHouseholdJoin);
	let householdDecision = $state<'join' | 'create' | null>(null);
	$effect(() => {
		if (!allowHouseholdJoin && householdDecision === null) householdDecision = 'create';
	});
	/** Same as `useHouseholds`, but `enabled` only for onsite create (no Couch fetch on public). */
	const householdsQuery = safeQuery(
		() =>
			createQuery(() => ({
				queryKey: peopleKeys.households(),
				queryFn: () => peopleRepository().listHouseholds(),
				enabled: channel === 'onsite' && enableResidenceJoin
			})),
		{
			data: [],
			isLoading: false
		} as unknown as ReturnType<typeof useHouseholds>
	);

	/** Onsite create, once a family is joined: its current members for the read-only list. */
	const evacueesQuery = safeQuery(
		() =>
			createQuery(() => ({
				queryKey: peopleKeys.evacuees(),
				queryFn: () => peopleRepository().listEvacuees(),
				enabled: channel === 'onsite' && mode === 'create' && Boolean(joinHouseholdId)
			})),
		{
			data: [],
			isLoading: false
		} as unknown as ReturnType<typeof useEvacuees>
	);

	const hasJoinSelection = $derived(Boolean(joinHouseholdId || joinMatchToken));
	const phoneSearchQuery = $derived(normalizeThaiPhone(searchPhoneQuery.trim()));
	const phoneSearchEnabled = $derived(
		channel === 'onsite' &&
			enableResidenceJoin &&
			isThaiPhone(phoneSearchQuery) &&
			!hasJoinSelection
	);
	const phoneSearch = useSearchEvacuees(
		() => phoneSearchQuery,
		() => phoneSearchEnabled
	);
	const phoneHouseholdSuggestions = $derived.by((): PhoneHouseholdMatchCandidate[] =>
		suggestHouseholdsByPhone(phoneSearchQuery, phoneSearch.data ?? [], householdsQuery.data ?? [])
	);
	const phoneSearchPending = $derived(phoneSearchEnabled && phoneSearch.isFetching);
	const phoneSearchCheckedEmpty = $derived(
		phoneSearchEnabled && !phoneSearch.isFetching && phoneHouseholdSuggestions.length === 0
	);

	function normalizedName(first?: string | null, last?: string | null): string {
		return `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
	}

	/** The joined family's existing member this card duplicates (same ID number or same full name). */
	function findExistingFamilyMember(m: UnifiedMemberWithMeta) {
		const idNo = m.person_id?.number?.replace(/\D/g, '') ?? '';
		const name = normalizedName(m.first_name, m.last_name);
		return joinedFamilyMembers.find((e) => {
			if (m._id && m._id === e._id) return false;
			const existingNo = e.person_id?.number?.replace(/\D/g, '') ?? '';
			if (idNo && existingNo && idNo === existingNo) return true;
			return Boolean(name) && name === normalizedName(e.first_name, e.last_name);
		});
	}

	/** The joined family's head stays its primary contact (onsite). */
	const joinedFamilyHeadName = $derived.by(() => {
		if (joinedFamilyMembers.length === 0) return '';
		const headId = (householdsQuery.data ?? []).find(
			(h) => h._id === joinHouseholdId
		)?.head_evacuee_id;
		const head = joinedFamilyMembers.find((e) => e._id === headId) ?? joinedFamilyMembers[0]!;
		return formatPersonName(head);
	});

	const GONE_STAY_STATUSES = new Set(['cancelled', 'checked_out', 'deceased', 'transferred']);
	/** Onsite join: the family's current members, shown read-only so staff see who is already in. */
	const joinedFamilyMembers = $derived(
		channel === 'onsite' && joinHouseholdId
			? (evacueesQuery.data ?? []).filter(
					(e) =>
						e.household_id === joinHouseholdId && !GONE_STAY_STATUSES.has(e.current_stay.status)
				)
			: []
	);

	$effect(() => {
		if (initialMembers && !touched) {
			members = buildInitialMembers();
		}
	});

	$effect(() => {
		if (initialHousehold && !touched) {
			household = buildInitialHousehold();
			assetDescription = initialHousehold.assets?.description ?? '';
			petItems = parseInitialPets((initialHousehold.pets ?? []) as PetGroup[]).items;
		}
	});

	/** Onsite: debounce local household list suggest (FR-03b-H pattern). */
	$effect(() => {
		if (!enableResidenceJoin || channel !== 'onsite') {
			residenceSuggestions = [];
			return;
		}

		const households = householdsQuery.data ?? [];

		const deps = readResidenceSuggestDeps(
			'create',
			household,
			households,
			Boolean(householdsQuery.isLoading) && households.length === 0
		);
		const tick = residenceSuggestTick(deps);

		if (residenceSuggestTimer) clearTimeout(residenceSuggestTimer);

		if (tick.kind === 'clear') {
			residenceSuggestions = [];
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = false;
			if (untrack(() => joinHouseholdId) && !untrack(() => joinViaPhone)) dropJoinWithNotice();
			return;
		}

		if (tick.kind === 'pending') {
			residenceSuggestions = [];
			residenceSuggestPending = true;
			residenceSuggestCheckedEmpty = false;
			return;
		}

		residenceSuggestPending = true;
		residenceSuggestCheckedEmpty = false;
		const matches = tick.matches;
		const selectedId = untrack(() => joinHouseholdId);
		residenceSuggestTimer = setTimeout(() => {
			residenceSuggestions = matches;
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = matches.length === 0;
			if (
				selectedId &&
				!untrack(() => joinViaPhone) &&
				!matches.some((m) => m._id === selectedId)
			) {
				dropJoinWithNotice();
			}
		}, 350);
		return () => {
			if (residenceSuggestTimer) clearTimeout(residenceSuggestTimer);
		};
	});

	/** Public: debounce BFF residence-match (token + non-PII chips only). */
	$effect(() => {
		if (!enableResidenceJoin || channel !== 'public') {
			publicMatchChips = [];
			return;
		}

		// Active join: skip rematch. HMAC match_tokens rotate on every matchResidence call, so
		// re-running (e.g. typing head phone) would mint new tokens and wipe the selection. Read
		// joinMatchToken without untrack so clearing ("สร้างใหม่แทน") re-enters and rematches.
		if (joinMatchToken) return;

		const form: ResidenceFields = {
			housing_type: household.housing_type,
			residence_landmark: household.residence_landmark,
			// Dorm: match on the same composed address_no that gets persisted (CR-148 FR-16)
			address_no: dormFieldsFor(household).address_no,
			village_no: household.village_no,
			subdistrict: household.subdistrict,
			district: household.district,
			province: household.province,
			postal_code: household.postal_code
		};

		/** Phone from quick search bar, or fallback to head member's phone. */
		const phone = normalizeThaiPhone(searchPhoneQuery.trim() || members[0]?.phone?.trim() || '');
		const hasSearchPhone = isThaiPhone(phone);

		if (!hasMinimumResidence(form) && !hasSearchPhone) {
			publicMatchChips = [];
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = false;
			residenceSuggestFailed = false;
			return;
		}

		const useUnassigned = enableUnassignedPhoto || !shelterCode.trim();
		const request = useUnassigned
			? {
					unassigned: true as const,
					housing_type: form.housing_type,
					residence_landmark: form.residence_landmark,
					address_no: form.address_no,
					village_no: form.village_no,
					subdistrict: form.subdistrict,
					district: form.district,
					province: form.province,
					postal_code: form.postal_code,
					phone: hasSearchPhone ? phone : undefined
				}
			: {
					shelter_code: shelterCode.trim(),
					housing_type: form.housing_type,
					residence_landmark: form.residence_landmark,
					address_no: form.address_no,
					village_no: form.village_no,
					subdistrict: form.subdistrict,
					district: form.district,
					province: form.province,
					postal_code: form.postal_code,
					phone: hasSearchPhone ? phone : undefined
				};

		residenceSuggestPending = true;
		residenceSuggestCheckedEmpty = false;
		residenceSuggestFailed = false;
		let ignore = false;
		const timer = setTimeout(() => {
			void matchResidence(request).then((result) => {
				if (ignore) return;
				publicMatchChips = result.matches;
				residenceSuggestPending = false;
				residenceSuggestFailed = result.failed;
				residenceSuggestCheckedEmpty = !result.failed && result.matches.length === 0;
			});
		}, 350);

		return () => {
			ignore = true;
			clearTimeout(timer);
		};
	});

	const formSectionNav = $derived.by(() => {
		const items: { id: FormSectionId; label: string; icon: typeof Home }[] = [
			{ id: 'address', label: t.sectionAddress, icon: Home },
			{ id: 'members', label: t.sectionMembers, icon: Users },
			{ id: 'pets', label: t.sectionPets, icon: PawPrint }
		];
		if (showVehiclesAssets) {
			items.push({ id: 'vehicles', label: t.sectionVehicles, icon: Package });
		}
		return items;
	});

	const membersSectionDesc = $derived(
		joinedFamilyMembers.length > 0
			? t.membersDescJoined
			: mode === 'report-in'
				? t.membersDescReportIn
				: showVehiclesAssets
					? `${t.sectionMembersDesc} ${t.sectionMembersDescOnsite}`
					: t.sectionMembersDesc
	);

	const effectiveSubmitLabel = $derived(
		submitLabel ??
			(mode === 'report-in'
				? t.submitReportIn
				: channel === 'public'
					? t.submitConfirm
					: t.submitOnsite)
	);

	onMount(() => {
		onDirtyChange?.(false);

		if (initialThaidProfile && !hasAutofilled) {
			hasAutofilled = true;
			void tick().then(() => {
				handleThaiDAutofill(initialThaidProfile);
			});
		}

		if (channel === 'public' && typeof window !== 'undefined') {
			void fetchThaidRegistrationStatus().then((s) => {
				thaidEnabled = s.enabled;
			});

			const params = new URLSearchParams(window.location.search);
			const errorParam = params.get('error');
			if (errorParam) {
				if (errorParam === 'thaid_disabled') {
					toast.error(t.thaidDisabledToast);
				} else if (errorParam === 'invalid_state') {
					toast.error(t.thaidInvalidStateToast);
				} else {
					toast.error(t.thaidFailedToast(errorParam));
				}
				const cleanUrl = new URL(window.location.href);
				cleanUrl.searchParams.delete('error');
				void tick().then(() =>
					replaceState(resolve((cleanUrl.pathname + cleanUrl.search) as '/'), {})
				);
			}

			if (params.get('thaid') === 'autofill' && !hasAutofilled) {
				hasAutofilled = true;
				void fetch('/api/public/v1/thaid/claim')
					.then(async (res) => {
						if (!res.ok) return null;
						return (await res.json()) as { profile?: ThaiDAutofillProfile | null };
					})
					.then((data) => {
						if (data?.profile) {
							void tick().then(() => {
								handleThaiDAutofill(data.profile!);
							});
						}
					})
					.catch(() => {
						toast.error(t.thaidClaimFailedToast);
					})
					.finally(() => {
						const cleanUrl = new URL(window.location.href);
						cleanUrl.searchParams.delete('thaid');
						replaceState(resolve((cleanUrl.pathname + cleanUrl.search) as '/'), {});
					});
			}
		}
	});

	function findScrollParent(element: Element): Element | null {
		let parent = element.parentElement;
		while (parent) {
			const { overflowY } = getComputedStyle(parent);
			if (overflowY === 'auto' || overflowY === 'scroll') return parent;
			parent = parent.parentElement;
		}
		return null;
	}

	function createScrollSpy(): import('svelte/attachments').Attachment {
		return (node) => {
			const sectionNodes = () =>
				formSectionNav
					.map((s) => document.getElementById(`unified-${s.id}`))
					.filter((el): el is HTMLElement => el instanceof HTMLElement);

			const scrollRoot = findScrollParent(node);
			const stickyTopPx = readRegistrationStickyTopPx(node);
			const ratiosById = new Map<string, number>();

			const syncActive = () => {
				if (scrollSpyPaused) return;
				const sectionIds = formSectionNav.map((s) => s.id);
				const next = pickActiveSectionId(sectionIds, ratiosById, {
					atScrollEnd: isScrollNearEnd(scrollRoot)
				});
				if (next && formSectionNav.some((s) => s.id === next)) {
					activeSection = next as FormSectionId;
				}
			};

			const observer = new IntersectionObserver(
				(entries) => {
					applyIntersectionEntries(
						ratiosById,
						entries.flatMap((entry) => {
							const target = entry.target;
							if (!(target instanceof HTMLElement) || !target.id.startsWith('unified-')) {
								return [];
							}
							return [
								{
									id: target.id.replace('unified-', ''),
									isIntersecting: entry.isIntersecting,
									intersectionRatio: entry.intersectionRatio
								}
							];
						})
					);
					syncActive();
				},
				{
					root: scrollRoot,
					rootMargin: `-${Math.round(stickyTopPx + 8)}px 0px -55% 0px`,
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
				}
			);

			for (const el of sectionNodes()) observer.observe(el);
			const scrollTarget: Element | Window = scrollRoot ?? window;
			scrollTarget.addEventListener('scroll', syncActive, { passive: true });
			return () => {
				observer.disconnect();
				scrollTarget.removeEventListener('scroll', syncActive);
			};
		};
	}

	$effect(() => {
		if (typeof window === 'undefined' || !window.visualViewport) return;
		const vv = window.visualViewport;
		const checkViewport = () => {
			if (window.innerWidth < 640) {
				const heightDiff = window.innerHeight - vv.height;
				isVirtualKeyboardOpen = heightDiff > 150;
			} else {
				isVirtualKeyboardOpen = false;
			}
		};

		vv.addEventListener('resize', checkViewport);
		vv.addEventListener('scroll', checkViewport);

		return () => {
			vv.removeEventListener('resize', checkViewport);
			vv.removeEventListener('scroll', checkViewport);
		};
	});

	function scrollToSection(sectionId: FormSectionId) {
		scrollSpyPaused = true;
		activeSection = sectionId;
		document.getElementById(`unified-${sectionId}`)?.scrollIntoView({
			behavior: 'smooth',
			block: 'start'
		});
		window.setTimeout(() => {
			scrollSpyPaused = false;
		}, 700);
	}

	function markDirty() {
		if (readOnly || touched) return;
		touched = true;
		onDirtyChange?.(true);
	}

	function clearDirty() {
		if (!touched) return;
		touched = false;
		onDirtyChange?.(false);
	}

	const addrGap = $derived(langState.current === 'en' ? ' ' : '');

	function formatResidenceSummary(r: ResidenceFields): string {
		const parts = [
			r.residence_landmark,
			r.address_no,
			r.village_no,
			r.subdistrict ? `${t.addrSubdistrictAbbr}${addrGap}${r.subdistrict}` : '',
			r.district ? `${t.addrDistrictAbbr}${addrGap}${r.district}` : '',
			r.province ? `${t.addrProvinceAbbr}${addrGap}${r.province}` : '',
			r.postal_code
		].filter((p) => (p ?? '').toString().trim());
		return parts.join(' ') || '—';
	}

	/**
	 * Join picked from the phone search. The address suggest must not drop it: the family's
	 * copied address may be too sparse to re-match itself, and a silently dropped join turns
	 * the save into a brand-new (duplicate) household.
	 */
	let joinViaPhone = $state(false);

	function clearJoinSelection() {
		joinViaPhone = false;
		joinHouseholdId = null;
		joinMatchToken = null;
		joinSelectedSummary = null;
		selectedMatchChip = null;
		if (allowHouseholdJoin) householdDecision = null;
	}

	/**
	 * The search changed under an active join (address / phone edited). Clearing it silently
	 * would turn the next save into a brand-new household — a duplicate family — so say so.
	 */
	function dropJoinWithNotice() {
		if (!joinHouseholdId && !joinMatchToken) return;
		clearJoinSelection();
		toast.warning(t.joinDroppedToast);
	}

	$effect(() => {
		if (joinResetKey > 0) {
			clearJoinSelection();
		}
	});

	function confirmOnsiteJoin(suggestion: ResidenceMatchCandidate) {
		createNewConfirmed = false;
		joinHouseholdId = suggestion._id;
		joinMatchToken = null;
		joinSelectedSummary = suggestion.label?.trim() || formatResidenceSummary(suggestion);

		// A phone search finds the family before any address is typed — copy theirs in
		// (the fields lock while joined). Reassign so the cascading selects follow.
		const source = suggestion as ResidenceMatchCandidate &
			Pick<UnifiedHouseholdInput, 'dorm_name' | 'dorm_building' | 'dorm_floor' | 'dorm_room'>;
		household = {
			...household,
			housing_type: (source.housing_type as HousingType) || household.housing_type,
			residence_landmark: source.residence_landmark ?? household.residence_landmark,
			dorm_name: source.dorm_name ?? household.dorm_name ?? null,
			dorm_building: source.dorm_building ?? household.dorm_building ?? null,
			dorm_floor: source.dorm_floor ?? household.dorm_floor ?? null,
			dorm_room: source.dorm_room ?? household.dorm_room ?? null,
			address_no: source.address_no || household.address_no,
			village_no: source.village_no || household.village_no,
			province: source.province || household.province,
			district: source.district || household.district,
			subdistrict: source.subdistrict || household.subdistrict,
			postal_code: source.postal_code || household.postal_code
		};
		toast.success(t.joinFamilyLoadedToast);
		if (allowHouseholdJoin) householdDecision = 'join';
		markDirty();
	}

	function confirmOnsitePhoneJoin(suggestion: PhoneHouseholdMatchCandidate) {
		confirmOnsiteJoin(suggestion);
		household = {
			...household,
			housing_type: suggestion.housing_type ?? household.housing_type,
			residence_landmark: suggestion.residence_landmark ?? null,
			address_no: suggestion.address_no ?? '',
			village_no: suggestion.village_no ?? '',
			subdistrict: suggestion.subdistrict ?? '',
			district: suggestion.district ?? '',
			province: suggestion.province ?? '',
			postal_code: suggestion.postal_code ?? '',
			dorm_name: suggestion.dorm_name ?? null,
			dorm_building: suggestion.dorm_building ?? null,
			dorm_floor: suggestion.dorm_floor ?? null,
			dorm_room: suggestion.dorm_room ?? null
		};
		joinSelectedSummary = `${suggestion.label || t.joinThisFamily} · ${t.joinFoundViaMember(suggestion.matched_member_name)}`;
		joinViaPhone = true;
	}

	function canJoinPublicChip(chip: ResidenceMatchChip): boolean {
		// Mongo-queue family — always append-join (including after closed / claim).
		if (!chip.is_in_shelter) return true;

		// Shelter Couch HH hard-join only when that shelter accepts public pre-registration.
		if (chip.accepts_pre_registration === true) return true;
		const code = chip.shelter_code?.trim();
		return Boolean(code && bookableShelterCodes.includes(code));
	}

	function confirmPublicJoin(chip: ResidenceMatchChip) {
		createNewConfirmed = false;
		joinMatchToken = chip.match_token;
		joinHouseholdId = null;
		selectedMatchChip = chip;

		// Build summary with masked primary contact
		const addrPart = chip.address
			? `${t.addrHouseNo} ${chip.address.address_no || '-'} ${chip.address.residence_landmark || ''}`.trim()
			: chip.landmark?.trim() || '';
		const contactPart = chip.primary_contact_masked
			? `${t.joinPrimaryContact} ${chip.primary_contact_masked}`
			: '';
		const shelterPart = chip.shelter_name ? `${t.joinShelter} ${chip.shelter_name}` : '';
		joinSelectedSummary =
			[addrPart, contactPart, shelterPart].filter(Boolean).join(' · ') || t.joinFamilyAtAddress;

		// Prefill address from chip (read-only lock via hasJoinSelection)
		if (chip.address) {
			household.housing_type = (chip.address.housing_type as HousingType) || household.housing_type;
			household.residence_landmark =
				chip.address.residence_landmark ?? household.residence_landmark;
			household.address_no = chip.address.address_no || household.address_no;
			household.village_no = chip.address.village_no || household.village_no;
			household.subdistrict = chip.address.subdistrict || household.subdistrict;
			household.district = chip.address.district || household.district;
			household.province = chip.address.province || household.province;
			household.postal_code = chip.address.postal_code || household.postal_code;
		}

		markDirty();
		toast.success(
			chip.pets && chip.pets.length > 0 ? t.joinFamilyLoadedWithPetsToast : t.joinFamilyLoadedToast
		);
	}

	/** ThaiD mock/real autofill: populate head member + address from profile. */
	function handleThaiDAutofill(profile: ThaiDAutofillProfile) {
		// Fill head member (index 0) personal info
		const head = members[0];
		if (head) {
			head.first_name = profile.first_name;
			head.last_name = profile.last_name;
			head.nickname = profile.nickname;
			head.gender = profile.gender;
			head.birth_year = profile.birth_year > 0 ? profile.birth_year : undefined;
			head.age = profile.age > 0 ? profile.age : undefined;
			if (profile.phone) head.phone = profile.phone;
			head.person_id = { cardType: 'national_id', number: profile.person_id };
			head.vulnerable_groups = profile.vulnerable_groups;
			head.special_needs = profile.special_needs;
			head.medical_conditions = profile.medical_conditions;
			members = [...members]; // trigger reactivity
		}

		// Fill address from ThaiD — reassign object to trigger reactive cascading selects
		household = {
			...household,
			address_no: profile.address.address_no || household.address_no,
			village_no: profile.address.village_no || household.village_no,
			province: profile.address.province || household.province,
			district: profile.address.district || household.district,
			subdistrict: profile.address.subdistrict || household.subdistrict,
			postal_code: profile.address.postal_code || household.postal_code
		};

		markDirty();
		toast.success(t.thaidHeadFetchedToast(`${profile.first_name} ${profile.last_name}`));
	}

	$effect(() => {
		if (initialThaidProfile && !hasAutofilled) {
			hasAutofilled = true;
			void tick().then(() => {
				handleThaiDAutofill(initialThaidProfile);
			});
		}
	});

	/** 「สร้างใหม่」 always asks first — skipping a found family is how duplicate households start. */
	let confirmCreateNewOpen = $state(false);
	/** Staff confirmed a new family; hide the found-family list until they ask for it again. */
	let createNewConfirmed = $state(false);

	function continueCreateDespiteSuggest() {
		confirmCreateNewOpen = true;
	}

	function confirmCreateNew() {
		confirmCreateNewOpen = false;
		createNewConfirmed = true;
		clearJoinSelection();
		if (allowHouseholdJoin) householdDecision = 'create';
		markDirty();
	}

	function chooseHouseholdJoin() {
		householdDecision = null;
		createNewConfirmed = false;
		clearJoinSelection();
		markDirty();
	}

	function onPetsSynced() {
		household.pets = syncPetsToHousehold(petItems);
		markDirty();
	}

	/** Section that owns an issue — the scroll fallback when no field carries `aria-invalid`. */
	function sectionForIssue(issue: RegistrationIssue | undefined): FormSectionId {
		const [root, key] = issue?.path ?? [];
		if (root !== 'household') return 'members';
		return key === 'pets' || key === 'vehicles' ? key : 'address';
	}

	/** Public channel only: primary contact needs a 10-digit phone (join flows may leave it blank). */
	function publicHeadPhoneMessage(): string | null {
		const headPhone = members[0]?.phone?.trim() ?? '';
		const phoneOk = /^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''));
		if (hasJoinSelection) return headPhone && !phoneOk ? t.joinPhoneInvalid : null;
		return phoneOk ? null : t.headPhoneRequired;
	}

	/** The registration as it would be sent — a pure copy, so it is safe to build while typing. */
	function buildPayload(): UnifiedRegistrationInput {
		return {
			// Empty phone → null so phoneSchema accepts optional join / 「ไม่มีเบอร์」.
			members: members.map((m) => (m.phone?.trim() ? m : { ...m, phone: null })),
			household: {
				...household,
				pets: syncPetsToHousehold(petItems),
				vehicles: showVehiclesAssets ? (household.vehicles ?? []) : [],
				assets:
					showVehiclesAssets && assetDescription.trim()
						? { description: assetDescription.trim(), image_url: null }
						: null
			},
			...(enableResidenceJoin
				? {
						join_household_id: joinHouseholdId || undefined,
						join_match_token: joinMatchToken || undefined
					}
				: {})
		};
	}

	/**
	 * Every problem with the form right now, in one pass (schema + member rules + the UI-only
	 * rules), so the user sees all of them after a single submit. Pure — it also drives the live
	 * re-validation that clears a field's error as soon as it is fixed.
	 */
	function collectValidation(): {
		parsed: ReturnType<typeof unifiedRegistrationInputSchema.safeParse>;
		entries: RegistrationErrorEntry[];
		fallbackSection: FormSectionId | undefined;
	} {
		const payload = buildPayload();
		const parsed = unifiedRegistrationInputSchema.safeParse(payload);
		// Zod 4 skips `superRefine` (checksum, age ↔ birth year, …) once the base schema aborts,
		// so collect the member rules separately and report them in the same pass.
		const issues: RegistrationIssue[] = parsed.success
			? []
			: [...parsed.error.issues, ...collectMemberRuleIssues(payload.members)];
		let fallbackSection: FormSectionId | undefined = issues.length
			? sectionForIssue(issues[0])
			: undefined;

		const extras: RegistrationIssue[] = [];
		const reported = (path: (string | number)[]) =>
			issues.some((i) => path.every((part, n) => i.path[n] === part));

		const headPhoneMessage = channel === 'public' ? publicHeadPhoneMessage() : null;
		if (headPhoneMessage && !reported(['members', 0, 'phone'])) {
			extras.push({ path: ['members', 0, 'phone'], message: headPhoneMessage });
			fallbackSection ??= 'members';
		}

		petItems.forEach((pet, index) => {
			if (
				pet.species === 'other' &&
				!pet.customSpecies.trim() &&
				!reported(['household', 'pets', index])
			) {
				extras.push({
					path: ['household', 'pets', index, 'notes'],
					message: t.petOtherSpeciesRequired
				});
				fallbackSection ??= 'pets';
			}
		});

		// Station 1 join: staff must pick the family or confirm a new one (no silent duplicate).
		if (allowHouseholdJoin && !hasJoinSelection && householdDecision !== 'create') {
			extras.push({ path: ['household_decision'], message: t.joinChooseOrCreate });
			fallbackSection ??= 'address';
		}

		// Joining: a card that is already in the family would be saved as a second copy of them.
		if (joinedFamilyMembers.length > 0) {
			members.forEach((member, index) => {
				const dup = findExistingFamilyMember(member);
				if (dup && !reported(['members', index, 'first_name'])) {
					extras.push({
						path: ['members', index, 'first_name'],
						message: t.joinMemberAlreadyIn(formatPersonName(dup))
					});
					fallbackSection ??= 'members';
				}
			});
		}

		for (const index of membersMissingPhoneChoice(members)) {
			if (!reported(['members', index, 'phone'])) {
				extras.push({ path: ['members', index, 'phone'], message: t.phoneOrNoPhoneRequired });
				fallbackSection ??= 'members';
			}
		}

		if (mode === 'report-in' && !members.some((m) => m.reporting_in)) {
			extras.push({ path: ['reporting_in'], message: t.reportInPickMember });
			fallbackSection ??= 'members';
		}

		return {
			parsed,
			entries: toRegistrationEntries([...issues, ...extras]),
			fallbackSection
		};
	}

	/**
	 * After a failed submit the form re-validates as the user types: a field keeps its error only
	 * while it is still invalid. Fields the submit did not flag never show an error before the next
	 * submit.
	 */
	const liveEntries = $derived(submittedEntries ? collectValidation().entries : null);
	const visibleErrors = $derived(
		toRegistrationFieldErrors(
			submittedEntries && liveEntries ? stillInvalidEntries(submittedEntries, liveEntries) : []
		)
	);

	/**
	 * Lists every issue in the summary banner, then takes the user straight to the
	 * first invalid field (same for public and staff). Errors with no field to
	 * point at land on `fallbackSection`, or on the banner when none is given.
	 */
	async function revealValidation(messages: string[], fallbackSection?: FormSectionId) {
		const message = messages[0] ?? t.validationError;
		// The toast title already carries `message` — list only the other issues underneath.
		const extraMessages = messages.filter((m) => m !== message).slice(0, 3);
		toast.error(message, {
			description: extraMessages.length > 0 ? extraMessages.join('\n') : undefined,
			duration: 6000
		});
		validationSeq += 1;
		await tick();
		if (focusFirstInvalid()) return;
		// A collapsed section may still be opening — give it one frame before falling back.
		await new Promise<void>((done) => requestAnimationFrame(() => done()));
		if (focusFirstInvalid()) return;
		if (fallbackSection) scrollToSection(fallbackSection);
		else formRootEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function focusFirstInvalid(): boolean {
		const field = firstInvalidField(formRootEl);
		if (!field) return false;
		// Composite controls (the gender radio group) flag a wrapper — focus the control inside it.
		const target = focusTargetFor(field);
		field.scrollIntoView({ behavior: 'smooth', block: 'center' });
		requestAnimationFrame(() => target.focus({ preventScroll: true }));
		return true;
	}

	function jumpToFirstError() {
		if (!focusFirstInvalid()) scrollToSection('members');
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending || readOnly) return;

		household.pets = syncPetsToHousehold(petItems);
		for (const m of members) {
			if (!m.phone?.trim()) m.phone = null;
		}

		const { parsed, entries, fallbackSection } = collectValidation();

		if (!parsed.success || entries.length > 0) {
			submittedEntries = entries;
			firstErrorMember =
				entries
					.map((entry) => (entry.path[0] === 'members' ? entry.path[1] : undefined))
					.filter((index): index is number => typeof index === 'number')
					.sort((a, b) => a - b)[0] ?? null;
			await revealValidation(toRegistrationFieldErrors(entries).messages, fallbackSection);
			return;
		}

		submittedEntries = null;
		firstErrorMember = null;
		try {
			await onsubmit(parsed.data as UnifiedRegistrationInput, {
				reportingInMembers: members.filter((m) => m.reporting_in),
				allMembers: members
			});
			clearDirty();
		} catch {
			// Caller surfaces save errors.
		}
	}
</script>

<form
	class="space-y-6"
	class:pointer-events-none={readOnly}
	class:opacity-70={readOnly}
	inert={readOnly || undefined}
	style={formStickyStyle}
	bind:this={formRootEl}
	onsubmit={handleSubmit}
	oninput={markDirty}
	{@attach createScrollSpy()}
>
	{#if visibleErrors.messages.length > 0}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5" role="alert">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">{t.validationSummaryTitle}</Alert.Title>
			<Alert.Description>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each visibleErrors.messages as msg (msg)}
						<li>{msg}</li>
					{/each}
				</ul>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="mt-3 h-9 border-destructive/40 text-destructive hover:bg-destructive/10"
					onclick={jumpToFirstError}
				>
					{t.jumpToFirstError}
				</Button>
			</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- 2-Column Responsive Layout on Desktop (lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start) -->
	<div class="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
		<!-- Left Column: Sticky Summary Card on desktop -->
		<aside
			class="hidden lg:sticky lg:top-[calc(var(--registration-sticky-top,0px)+1rem)] lg:col-span-4 lg:block"
		>
			<UnifiedRegistrationSummaryCard
				{shelterName}
				{shelterCode}
				{household}
				{members}
				{showVehiclesAssets}
				{activeSection}
				{pending}
				submitDisabled={submitDisabled || readOnly}
				submitLabel={effectiveSubmitLabel}
				submittingLabel={t.submitting}
				existingMembers={joinedFamilyMembers}
				existingHeadName={joinedFamilyHeadName}
				existingCount={channel === 'public' && hasJoinSelection
					? (selectedMatchChip?.member_count ?? 0)
					: 0}
				onNavigate={(id) => scrollToSection(id as FormSectionId)}
			/>
		</aside>

		<!-- Right Column: Form Area (Full width on mobile, 8-col on lg+) -->
		<div class="space-y-6 lg:col-span-8">
			<!-- Live summary for mobile and tablet; desktop uses the sticky card on the left. -->
			<div class="lg:hidden">
				<UnifiedRegistrationSummaryCard
					{shelterName}
					{shelterCode}
					{household}
					{members}
					{showVehiclesAssets}
					{activeSection}
					{pending}
					submitDisabled={submitDisabled || readOnly}
					submitLabel={effectiveSubmitLabel}
					submittingLabel={t.submitting}
					existingMembers={joinedFamilyMembers}
					existingHeadName={joinedFamilyHeadName}
					existingCount={channel === 'public' && hasJoinSelection
						? (selectedMatchChip?.member_count ?? 0)
						: 0}
					onNavigate={(id) => scrollToSection(id as FormSectionId)}
				/>
			</div>

			<!-- Top Progress Stepper (Mobile & Desktop) -->
			{#if channel !== 'public'}
				<UnifiedRegistrationStepper
					sections={formSectionNav}
					{activeSection}
					onNavigate={(id) => scrollToSection(id as FormSectionId)}
				/>
			{/if}

			<!-- ── Section 1: Address ─────────────────────────────────── -->
			<UnifiedRegistrationSection
				id="unified-address"
				title={t.sectionAddress}
				description={t.sectionAddressDesc}
				icon={Home}
			>
				<!-- ThaiD Action Button: Public Pre-Register -->
				{#if channel === 'public' && thaidEnabled}
					<ThaidActionButton
						shelterCode={shelterCode || (enableUnassignedPhoto ? 'unassigned' : '')}
						disabled={fieldsLocked}
					/>
				{/if}

				<!-- Quick Search & Merge Tool Bar (both Public and Onsite) -->
				{#if enableResidenceJoin}
					<div class="mb-4 space-y-3 rounded-xl border border-border/60 bg-muted/10 p-3 sm:mb-5">
						<div class="flex items-center justify-between gap-2">
							<p class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
								<Search class="size-3.5 text-primary" />
								<span>
									{channel === 'public' ? t.familySearchTitlePublic : t.familySearchTitle}
								</span>
							</p>
						</div>
						<div class="relative w-full">
							<Input
								type="tel"
								inputmode="tel"
								maxlength={15}
								aria-label={channel === 'public' ? t.familySearchTitlePublic : t.familySearchTitle}
								placeholder={t.familySearchPlaceholder}
								value={searchPhoneQuery}
								oninput={(e) => {
									searchPhoneQuery = sanitizePhoneTyping(
										(e.currentTarget as HTMLInputElement).value
									);
									createNewConfirmed = false;
								}}
								onblur={() => (searchPhoneTouched = true)}
								disabled={fieldsLocked || hasJoinSelection}
								aria-invalid={!!searchPhoneError}
								aria-describedby={searchPhoneError ? 'family-search-phone-error' : undefined}
								class="h-9 w-full pr-7 text-sm"
							/>
							{#if searchPhoneQuery && !hasJoinSelection}
								<button
									type="button"
									class="absolute top-2.5 right-2.5 text-xs text-muted-foreground hover:text-foreground"
									onclick={() => {
										searchPhoneQuery = '';
										searchPhoneTouched = false;
									}}
									title={t.familySearchClear}
									aria-label={t.familySearchClear}
								>
									✕
								</button>
							{/if}
						</div>
						{#if searchPhoneError}
							<p id="family-search-phone-error" class="text-2xs text-destructive">
								{searchPhoneError}
							</p>
						{/if}
						{#if channel === 'public'}
							<p class="text-2xs text-muted-foreground">{t.familySearchHint}</p>
						{/if}
					</div>
				{/if}

				<!-- Joined family: its address was filled in for staff/the public and is locked -->
				<div
					class={{
						'space-y-2 rounded-xl transition-colors': true,
						'bg-primary/5 p-3 ring-2 ring-primary/40': hasJoinSelection
					}}
				>
					{#if hasJoinSelection}
						<p
							class="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
							role="status"
						>
							<CheckCircle2 class="size-3.5" aria-hidden="true" />
							{t.joinAddressLocked}
						</p>
					{/if}
					<HouseholdAddressFields
						bind:housing_type={household.housing_type}
						bind:residence_landmark={
							() => household.residence_landmark ?? '',
							(v) => {
								household.residence_landmark = v || null;
							}
						}
						bind:address_no={
							() => household.address_no ?? '',
							(v) => {
								household.address_no = v;
							}
						}
						bind:village_no={
							() => household.village_no ?? '',
							(v) => {
								household.village_no = v;
							}
						}
						bind:subdistrict={
							() => household.subdistrict ?? '',
							(v) => {
								household.subdistrict = v;
							}
						}
						bind:district={
							() => household.district ?? '',
							(v) => {
								household.district = v;
							}
						}
						bind:province={
							() => household.province ?? '',
							(v) => {
								household.province = v;
							}
						}
						bind:postal_code={
							() => household.postal_code ?? '',
							(v) => {
								household.postal_code = v;
							}
						}
						bind:dorm_name={household.dorm_name}
						bind:dorm_building={household.dorm_building}
						bind:dorm_floor={household.dorm_floor}
						bind:dorm_room={household.dorm_room}
						dormFields={true}
						errors={visibleErrors.household}
						loadMasterHousingTypes={channel !== 'public'}
						required={true}
						disabled={fieldsLocked || hasJoinSelection}
					/>
				</div>

				{#if enableResidenceJoin}
					{#if hasJoinSelection}
						<div
							class="mt-3 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3"
							role="status"
							aria-live="polite"
						>
							<p class="text-sm font-semibold text-foreground">{t.joinWillJoinTitle}</p>
							{#if joinSelectedSummary}
								<p class="text-xs text-muted-foreground">{joinSelectedSummary}</p>
							{/if}
							{#if joinedFamilyMembers.length > 0}
								<p class="text-xs text-muted-foreground">
									{t.joinExistingSeeBelow(joinedFamilyMembers.length)}
								</p>
							{:else if channel === 'public' && selectedMatchChip?.member_count}
								<p class="text-xs text-muted-foreground">
									{t.joinExistingCount(selectedMatchChip.member_count)}
								</p>
							{/if}
							<p class="text-xs text-muted-foreground">
								{t.joinFillNewOnly}
							</p>
							{#if selectedMatchChip?.shelter_code && selectedMatchChip.shelter_code !== shelterCode}
								<div
									class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-background/80 p-2 text-2xs"
								>
									<span class="text-muted-foreground">
										{t.joinAtShelterPrefix}

										<strong class="text-foreground"
											>{selectedMatchChip.shelter_name || selectedMatchChip.shelter_code}</strong
										>
										{t.joinAtShelterSuffix}
									</span>
									{#if onselectshelter}
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="h-6 border-primary/30 px-2 text-2xs text-primary hover:bg-primary/10"
											onclick={() =>
												onselectshelter?.(
													selectedMatchChip!.shelter_code!,
													selectedMatchChip!.shelter_name ?? undefined
												)}
										>
											{t.joinViewShelter}
										</Button>
									{/if}
								</div>
							{/if}
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={fieldsLocked}
								onclick={continueCreateDespiteSuggest}
							>
								{t.joinCreateInstead}
							</Button>
						</div>
					{:else if phoneSearchPending}
						<div
							class="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
							role="status"
							aria-live="polite"
						>
							<Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
							{t.joinSearchingPhone}
						</div>
					{:else if createNewConfirmed && (phoneHouseholdSuggestions.length > 0 || residenceSuggestions.length > 0 || publicMatchChips.length > 0)}
						<div
							class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
							role="status"
						>
							<span>{t.joinWillCreateNew}</span>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								class="h-7 text-xs"
								disabled={fieldsLocked}
								onclick={() => (createNewConfirmed = false)}
							>
								{t.joinShowMatchesAgain}
							</Button>
						</div>
					{:else if channel === 'onsite' && phoneHouseholdSuggestions.length > 0}
						<div class="mt-3 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
							<p class="text-xs font-semibold text-foreground">
								{t.joinPhoneMatchTitle}
							</p>
							<ul class="space-y-2">
								{#each phoneHouseholdSuggestions as suggestion (suggestion._id)}
									<li
										class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card p-2.5 text-sm"
									>
										<div class="min-w-0">
											<p class="font-medium text-foreground">
												{suggestion.label || t.joinUnnamedFamily}
											</p>
											<p class="text-xs text-muted-foreground">
												{t.joinMatchedMember}
												{suggestion.matched_member_name} ·
												{formatResidenceSummary(suggestion)}
											</p>
										</div>
										<div class="flex shrink-0 items-center gap-2">
											<Button
												type="button"
												size="sm"
												disabled={fieldsLocked}
												onclick={() => confirmOnsitePhoneJoin(suggestion)}
											>
												{t.joinAction}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={fieldsLocked}
												onclick={continueCreateDespiteSuggest}
											>
												{t.joinCreateNew}
											</Button>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{:else if residenceSuggestPending}
						<div
							class="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
							role="status"
							aria-live="polite"
						>
							<Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
							{t.joinSearchingAddress}
						</div>
					{:else if channel === 'onsite' && residenceSuggestions.length > 0}
						<div class="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
							<p class="text-xs font-semibold text-foreground">
								{t.joinNearbyTitle}
							</p>
							<ul class="space-y-2">
								{#each residenceSuggestions as suggestion (suggestion._id)}
									<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
										<span>
											{#if suggestion.label?.trim()}
												<span class="font-medium">{suggestion.label}</span>
												<span class="text-muted-foreground">
													· {formatResidenceSummary(suggestion)}
												</span>
											{:else}
												<span class="text-muted-foreground">
													{formatResidenceSummary(suggestion)}
												</span>
											{/if}
										</span>
										<div class="flex shrink-0 items-center gap-2">
											<Button
												type="button"
												size="sm"
												disabled={fieldsLocked}
												onclick={() => confirmOnsiteJoin(suggestion)}
											>
												{t.joinAction}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={fieldsLocked}
												onclick={continueCreateDespiteSuggest}
											>
												{t.joinCreateNew}
											</Button>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{:else if channel === 'public' && publicMatchChips.length > 0}
						<div class="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
							<p class="text-xs font-semibold text-foreground">
								{t.joinPublicMatchTitle}
							</p>
							<ul class="space-y-2">
								{#each publicMatchChips as chip (chip.match_token)}
									<li class="rounded-lg border border-border/60 bg-card p-2.5">
										<div class="flex flex-wrap items-start justify-between gap-2">
											<div class="flex flex-col gap-1">
												<!-- Address line (no "บ้านตนเอง") -->
												<span class="text-sm font-medium text-foreground">
													{#if chip.address?.address_no}
														{t.addrHouseNo}
														{chip.address.address_no}
														{chip.address.residence_landmark || ''}
													{:else}
														{chip.landmark?.trim() || t.joinFamilyAtAddress}
													{/if}
												</span>

												<!-- Masked primary contact -->
												{#if chip.primary_contact_masked}
													<span class="text-xs text-muted-foreground">
														{t.joinPrimaryContact}
														{chip.primary_contact_masked}
													</span>
												{/if}

												<!-- Shelter recommend copy -->
												{#if chip.is_in_shelter && chip.shelter_name}
													<span class="text-2xs text-muted-foreground">
														{t.joinChipInShelter(chip.shelter_name)}
														{#if !canJoinPublicChip(chip)}
															{t.joinChipNoWebPreReg}
														{/if}
													</span>
												{:else if chip.shelter_code || chip.shelter_name}
													<span class="text-2xs text-muted-foreground">
														{t.joinChipMembersAtShelter(
															chip.shelter_name || chip.shelter_code || ''
														)}
													</span>
												{/if}

												<!-- Member phone match confirmation badge -->
												{#if chip.matched_member_masked}
													<span
														class="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700"
													>
														<CheckCircle2 class="size-3" />
														{t.joinChipPhoneMatch}
														{chip.matched_member_masked}
													</span>
												{/if}

												<!-- Member & pet count badges -->
												<div class="mt-0.5 flex flex-wrap gap-1.5">
													{#if chip.member_count && chip.member_count > 0}
														<span
															class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
														>
															<Users class="size-3" />
															{t.joinChipMemberCount(chip.member_count)}
														</span>
													{/if}
													{#if chip.pets && chip.pets.length > 0}
														<span
															class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
														>
															<PawPrint class="size-3" />
															{t.joinChipPetCount(chip.pets.length)}
														</span>
													{/if}
												</div>
											</div>

											<div class="flex shrink-0 flex-col items-end gap-1.5">
												<div class="flex items-center gap-2">
													{#if canJoinPublicChip(chip)}
														<Button
															type="button"
															size="sm"
															disabled={fieldsLocked}
															onclick={() => confirmPublicJoin(chip)}
														>
															{chip.is_in_shelter ? t.joinAction : t.joinQueueAction}
														</Button>
													{/if}
													<Button
														type="button"
														size="sm"
														variant="outline"
														disabled={fieldsLocked}
														onclick={continueCreateDespiteSuggest}
													>
														{t.joinCreateNew}
													</Button>
												</div>
												{#if !canJoinPublicChip(chip)}
													<p class="max-w-[14rem] text-right text-2xs text-muted-foreground">
														{t.joinChipShelterClosed(chip.shelter_name ?? '')}
													</p>
												{/if}
											</div>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{:else if phoneSearchCheckedEmpty}
						<p class="mt-3 text-xs text-muted-foreground">
							{t.joinPhoneNotFound}
						</p>
					{:else if residenceSuggestFailed}
						<p class="mt-3 text-xs text-amber-800 dark:text-amber-200" role="status">
							{t.residenceMatchFailed}
						</p>
					{:else if residenceSuggestCheckedEmpty}
						<p class="mt-3 text-xs text-muted-foreground">
							{searchPhoneQuery.trim() ? t.joinPhoneNoMatch : t.joinAddressNoMatch}
						</p>
					{/if}

					{#if allowHouseholdJoin && !hasJoinSelection}
						<div
							class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3"
						>
							<div class="min-w-0 text-xs">
								<p class="font-semibold text-foreground">
									{householdDecision === 'create' ? t.joinDecisionCreate : t.joinDecisionRequired}
								</p>
								<p class="text-muted-foreground">
									{t.joinDecisionHint}
								</p>
							</div>
							{#if householdDecision === 'create'}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={fieldsLocked}
									onclick={chooseHouseholdJoin}
								>
									{t.joinBackToExisting}
								</Button>
							{:else}
								<Button
									type="button"
									size="sm"
									disabled={fieldsLocked}
									onclick={continueCreateDespiteSuggest}
								>
									{t.joinConfirmCreate}
								</Button>
							{/if}
						</div>
					{/if}
				{/if}
			</UnifiedRegistrationSection>

			<!-- ── Section 2: Members ─────────────────────────────────── -->
			<UnifiedRegistrationMembersSection
				bind:members
				memberFieldErrors={visibleErrors.members}
				membersError={visibleErrors.membersLimit}
				{validationSeq}
				{firstErrorMember}
				pending={fieldsLocked}
				{mode}
				{channel}
				{memberPhotoUpload}
				{shelterCode}
				{membersSectionDesc}
				isJoiningExistingHousehold={hasJoinSelection}
				existingMembers={joinedFamilyMembers}
				primaryContactPhone={members[0]?.phone ?? null}
				thaidEnabled={channel === 'public' && thaidEnabled}
				onDirty={markDirty}
			/>

			<!-- ── Section 3: Pets ────────────────────────────────────────── -->
			<UnifiedRegistrationPetsSection
				bind:petItems
				pending={fieldsLocked}
				{showPetPhotoUpload}
				{channel}
				{enableUnassignedPhoto}
				{shelterCode}
				existingPets={selectedMatchChip?.pets ?? []}
				petErrors={visibleErrors.pets}
				{validationSeq}
				onsync={onPetsSynced}
			/>

			<!-- ── Section 4: Vehicles + assets (optional; onsite default) ──────── -->
			{#if showVehiclesAssets}
				<UnifiedRegistrationVehiclesSection
					bind:vehicles={
						() => household.vehicles ?? [],
						(v) => {
							household.vehicles = v;
						}
					}
					bind:assetDescription
					pending={fieldsLocked}
					onDirty={markDirty}
				/>
			{/if}

			{#if children}
				<div class="pt-2">
					{@render children({
						household: {
							...household,
							vehicles: showVehiclesAssets ? (household.vehicles ?? []) : [],
							assets:
								showVehiclesAssets && assetDescription.trim()
									? { description: assetDescription.trim(), image_url: null }
									: null
						}
					})}
				</div>
			{/if}

			<div class="unified-reg-bottom-chrome {isVirtualKeyboardOpen ? 'max-sm:hidden' : ''}">
				<div class="space-y-2">
					<button
						type="button"
						class="touch-target inline-flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 text-left text-xs font-semibold text-foreground shadow-2xs transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none lg:hidden"
						aria-haspopup="dialog"
						aria-expanded={mobileSummaryOpen}
						onclick={() => (mobileSummaryOpen = true)}
					>
						<span class="inline-flex min-w-0 items-center gap-1.5">
							<Users class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
							<span class="truncate tabular-nums">{mobileSummaryChipLabel}</span>
						</span>
						<ChevronUp class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					</button>
					<div class="flex items-center gap-2">
						<div class="lg:hidden">
							<UnifiedRegistrationStickyNav
								compact={true}
								sections={formSectionNav}
								{activeSection}
								ariaLabel={t.sectionNavAria}
								onNavigate={(id) => scrollToSection(id as FormSectionId)}
							/>
						</div>
						{#if !readOnly}
							<div class="min-w-0 flex-1">
								<UnifiedRegistrationSubmitBar
									{pending}
									{submitDisabled}
									label={effectiveSubmitLabel}
									submittingLabel={t.submitting}
									align={submitAlign}
									sticky={false}
								/>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<Sheet.Root bind:open={mobileSummaryOpen}>
				<Sheet.Content
					side="bottom"
					class="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
				>
					<Sheet.Header class="sr-only">
						<Sheet.Title>สรุปข้อมูลการลงทะเบียน</Sheet.Title>
						<Sheet.Description>{mobileSummaryChipLabel}</Sheet.Description>
					</Sheet.Header>
					<div class="min-h-0 flex-1 overflow-y-auto p-3">
						<UnifiedRegistrationSummaryCard
							{shelterName}
							{shelterCode}
							{household}
							{members}
							{showVehiclesAssets}
							{activeSection}
							{pending}
							submitDisabled={submitDisabled || readOnly}
							submitLabel={effectiveSubmitLabel}
							submittingLabel={t.submitting}
							showSubmit={false}
							onNavigate={(id) => {
								mobileSummaryOpen = false;
								scrollToSection(id as FormSectionId);
							}}
						/>
					</div>
				</Sheet.Content>
			</Sheet.Root>
		</div>
	</div>
</form>

<AlertDialog.Root bind:open={confirmCreateNewOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t.createNewDialogTitle}</AlertDialog.Title>
			<AlertDialog.Description>
				{t.createNewDialogDesc}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t.createNewDialogCancel}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmCreateNew}>{t.createNewDialogConfirm}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

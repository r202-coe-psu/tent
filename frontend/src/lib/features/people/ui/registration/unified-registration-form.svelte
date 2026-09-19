<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Users from '@lucide/svelte/icons/users';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { ZodIssue } from 'zod';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
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
	import HouseholdMergeDialog from '../household-flows/household-merge-dialog.svelte';
	import { readRegistrationStickyTopPx } from './registration-sticky-offset';
	import {
		applyIntersectionEntries,
		isScrollNearEnd,
		pickActiveSectionId
	} from './registration-scroll-spy';
	import {
		createPetCard,
		parseInitialPets,
		syncPetsToHousehold,
		type PetCardItem
	} from './unified-registration-pets';
	import {
		blankUnifiedMember,
		evacueeToUnifiedMember,
		unifiedRegistrationInputSchema,
		type MemberPhotoUploadMode,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput,
		type UnifiedHouseholdInput
	} from '../../domain/unified-registration';
	import type {
		Evacuee,
		Household,
		HousingType,
		HouseholdVehicle,
		PetGroup
	} from '../../domain/people';
	import {
		hasMinimumResidence,
		type ResidenceFields,
		type ResidenceMatchCandidate
	} from '../../domain/registration-shell';
	import { peopleKeys, useHouseholds } from '../../application/queries';
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
		shelterCode = '',
		shelterName = '',
		initialThaidProfile = null,
		onsubmit,
		onselectshelter,
		onDirtyChange,
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
		shelterCode?: string;
		shelterName?: string;
		initialThaidProfile?: ThaiDAutofillProfile | null;
		onsubmit: (
			input: UnifiedRegistrationInput,
			meta?: { reportingInMembers: UnifiedMemberWithMeta[]; allMembers: UnifiedMemberWithMeta[] }
		) => Promise<void> | void;
		onselectshelter?: (shelterCode: string, shelterName?: string) => void;
		onDirtyChange?: (dirty: boolean) => void;
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
				...m,
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
	let formError = $state<string | null>(null);
	let validationMessages = $state<string[]>([]);
	let memberFieldErrors = $state<Record<number, Record<string, string>>>({});
	let formRootEl = $state<HTMLFormElement | null>(null);
	let touched = $state(false);
	let hasAutofilled = $state(false);
	let activeSection = $state<FormSectionId>('address');
	let scrollSpyPaused = $state(false);

	let petItems = $state<PetCardItem[]>(
		untrack(() => parseInitialPets(household.pets as PetGroup[]).items)
	);

	/** Create-path residence join — at most one of id (onsite) / token (public). */
	let joinHouseholdId = $state<string | null>(null);
	let joinMatchToken = $state<string | null>(null);
	let joinSelectedSummary = $state<string | null>(null);

	/** Quick search bar for member phone (household search enhancement). */
	let searchPhoneQuery = $state('');

	/** Household merge dialog state. */
	let mergeDialogOpen = $state(false);
	let absorbedHouseholdIds = $state<string[]>([]);

	/** Currently selected match chip from public residence match (for address prefill & pets). */
	let selectedMatchChip = $state<ResidenceMatchChip | null>(null);

	let residenceSuggestTimer: ReturnType<typeof setTimeout> | null = null;
	let residenceSuggestions = $state<ResidenceMatchCandidate[]>([]);
	let publicMatchChips = $state<ResidenceMatchChip[]>([]);
	let residenceSuggestPending = $state(false);
	let residenceSuggestCheckedEmpty = $state(false);

	const enableResidenceJoin = $derived(mode === 'create');
	/** Same as `useHouseholds`, but `enabled` only for onsite create (no Couch fetch on public). */
	const householdsQuery = safeQuery(
		() =>
			createQuery(() => ({
				queryKey: peopleKeys.households(),
				queryFn: () => peopleRepository().listHouseholds(),
				enabled: channel === 'onsite' && mode === 'create'
			})),
		{
			data: [],
			isLoading: false
		} as unknown as ReturnType<typeof useHouseholds>
	);

	const hasJoinSelection = $derived(Boolean(joinHouseholdId || joinMatchToken));

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
			if (untrack(() => joinHouseholdId)) clearJoinSelection();
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
			if (selectedId && !matches.some((m) => m._id === selectedId)) {
				clearJoinSelection();
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

		const form: ResidenceFields = {
			housing_type: household.housing_type,
			residence_landmark: household.residence_landmark,
			address_no: household.address_no,
			village_no: household.village_no,
			subdistrict: household.subdistrict,
			district: household.district,
			province: household.province,
			postal_code: household.postal_code
		};

		/** Phone from quick search bar, or fallback to head member's phone. */
		const phone = searchPhoneQuery.trim() || members[0]?.phone?.trim() || '';
		const hasSearchPhone = /^0\d{8,9}$/.test(phone.replace(/[-\s]/g, ''));

		if (!hasMinimumResidence(form) && !hasSearchPhone) {
			publicMatchChips = [];
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = false;
			if (untrack(() => joinMatchToken)) clearJoinSelection();
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
		let ignore = false;
		const selectedToken = untrack(() => joinMatchToken);
		const timer = setTimeout(() => {
			void matchResidence(request).then((result) => {
				if (ignore) return;
				publicMatchChips = result.matches;
				residenceSuggestPending = false;
				residenceSuggestCheckedEmpty = result.matches.length === 0;
				if (selectedToken && !result.matches.some((m) => m.match_token === selectedToken)) {
					clearJoinSelection();
				}
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
		mode === 'report-in'
			? 'ตรวจสอบข้อมูลสมาชิก และติ๊กเลือกผู้ที่มารายงานตัวในรอบนี้ (สามารถกดเพิ่มสมาชิกใหม่ที่เดินทางมาด้วยกันได้)'
			: showVehiclesAssets
				? `${t.sectionMembersDesc} ${t.sectionMembersDescOnsite}`
				: t.sectionMembersDesc
	);

	const effectiveSubmitLabel = $derived(
		submitLabel ??
			(mode === 'report-in'
				? 'ยืนยันรายงานตัวและพิมพ์บัตร'
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
			const params = new URLSearchParams(window.location.search);
			const errorParam = params.get('error');
			if (errorParam) {
				if (errorParam === 'thaid_disabled') {
					toast.error('การลงทะเบียนผ่าน ThaiD ถูกปิดใช้งานชั่วคราว');
				} else if (errorParam === 'invalid_state') {
					toast.error('การยืนยันตัวตน ThaiD ไม่ถูกต้อง หรือหมดอายุ กรุณาลองใหม่อีกครั้ง');
				} else {
					toast.error(`การยืนยันตัวตน ThaiD ไม่สำเร็จ (${errorParam})`);
				}
				const cleanUrl = new URL(window.location.href);
				cleanUrl.searchParams.delete('error');
				window.history.replaceState(
					{},
					'',
					cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : '')
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
						toast.error('ไม่สามารถดึงข้อมูลจาก ThaiD ได้');
					})
					.finally(() => {
						const cleanUrl = new URL(window.location.href);
						cleanUrl.searchParams.delete('thaid');
						window.history.replaceState(
							{},
							'',
							cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : '')
						);
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

	function formatResidenceSummary(r: ResidenceFields): string {
		const parts = [
			r.residence_landmark,
			r.address_no,
			r.village_no,
			r.subdistrict ? `ต.${r.subdistrict}` : '',
			r.district ? `อ.${r.district}` : '',
			r.province ? `จ.${r.province}` : '',
			r.postal_code
		].filter((p) => (p ?? '').toString().trim());
		return parts.join(' ') || '—';
	}

	function clearJoinSelection() {
		joinHouseholdId = null;
		joinMatchToken = null;
		joinSelectedSummary = null;
		selectedMatchChip = null;
	}

	function confirmOnsiteJoin(suggestion: ResidenceMatchCandidate) {
		joinHouseholdId = suggestion._id;
		joinMatchToken = null;
		joinSelectedSummary = suggestion.label?.trim() || formatResidenceSummary(suggestion);
		markDirty();
	}

	function confirmPublicJoin(chip: ResidenceMatchChip) {
		joinMatchToken = chip.match_token;
		joinHouseholdId = null;
		selectedMatchChip = chip;

		// Build summary with masked primary contact
		const addrPart = chip.address
			? `บ้านเลขที่ ${chip.address.address_no || '-'} ${chip.address.residence_landmark || ''}`.trim()
			: chip.landmark?.trim() || '';
		const contactPart = chip.primary_contact_masked
			? `ผู้ติดต่อหลัก: ${chip.primary_contact_masked}`
			: '';
		const shelterPart = chip.shelter_name ? `ศูนย์: ${chip.shelter_name}` : '';
		joinSelectedSummary =
			[addrPart, contactPart, shelterPart].filter(Boolean).join(' · ') || 'ครอบครัวที่อยู่นี้';

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
			head.birth_year = profile.birth_year;
			head.age = profile.age;
			if (profile.phone) head.phone = profile.phone;
			head.person_id = { cardType: 'national_id', number: profile.person_id };
			head.vulnerable_groups = profile.vulnerable_groups;
			head.special_needs = profile.special_needs;
			head.medical_conditions = profile.medical_conditions;
			members = [...members]; // trigger reactivity
		}

		// Fill address from ThaiD
		household.address_no = profile.address.address_no;
		household.village_no = profile.address.village_no;
		household.subdistrict = profile.address.subdistrict;
		household.district = profile.address.district;
		household.province = profile.address.province;
		household.postal_code = profile.address.postal_code;

		markDirty();
		toast.success(`ดึงข้อมูล ${profile.first_name} ${profile.last_name} เรียบร้อย`);
	}

	$effect(() => {
		if (initialThaidProfile && !hasAutofilled) {
			hasAutofilled = true;
			void tick().then(() => {
				handleThaiDAutofill(initialThaidProfile);
			});
		}
	});

	/** Absorb another household into the current form (merge-in-form). */
	function handleAbsorbHouseholdIntoForm(sourceHousehold: Household, sourceMembers: Evacuee[]) {
		// Add absorbed household ID for post-submit merge marking
		absorbedHouseholdIds = [...absorbedHouseholdIds, sourceHousehold._id];

		// Convert source evacuees to unified members and append
		const converted = sourceMembers.map((ev) => evacueeToUnifiedMember(ev));
		members = [...members, ...converted];

		// Merge pets from source household
		const sourcePets = (sourceHousehold.pets ?? []) as PetGroup[];
		if (sourcePets.length > 0) {
			const existingSpecies = new SvelteSet(petItems.map((p) => p.species));
			let nextId = Math.max(0, ...petItems.map((p) => p.id)) + 1;
			for (const pg of sourcePets) {
				const species = pg.species as 'dog' | 'cat' | 'other';
				if (!existingSpecies.has(species)) {
					const card = createPetCard(species, nextId++);
					card.details = pg.notes ?? '';
					if (species === 'other') card.customSpecies = pg.species;
					petItems = [...petItems, card];
					existingSpecies.add(species);
				}
			}
			household.pets = syncPetsToHousehold(petItems);
		}

		markDirty();
	}

	function continueCreateDespiteSuggest() {
		clearJoinSelection();
		markDirty();
	}

	function onPetsSynced() {
		household.pets = syncPetsToHousehold(petItems);
		markDirty();
	}

	function mapZodIssues(issues: ZodIssue[]): {
		messages: string[];
		memberErrors: Record<number, Record<string, string>>;
	} {
		const messages: string[] = [];
		const memberErrors: Record<number, Record<string, string>> = {};
		for (const issue of issues) {
			messages.push(issue.message);
			const [root, idx, field] = issue.path;
			if (root === 'members' && typeof idx === 'number' && typeof field === 'string') {
				memberErrors[idx] ??= {};
				if (!memberErrors[idx][field]) memberErrors[idx][field] = issue.message;
			}
		}
		return {
			messages: [...new Set(messages.filter(Boolean))],
			memberErrors
		};
	}

	async function revealValidation(message: string, messages: string[] = []) {
		formError = message;
		validationMessages = messages.length > 0 ? messages : [message];
		toast.error(message, {
			description: validationMessages.slice(0, 3).join('\n'),
			duration: 6000
		});
		await tick();
		formRootEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function jumpToFirstError() {
		const firstInvalid = formRootEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
		if (firstInvalid) {
			firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
			requestAnimationFrame(() => firstInvalid.focus({ preventScroll: true }));
			return;
		}
		scrollToSection('members');
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending || readOnly) return;

		for (const p of petItems) {
			if (p.species === 'other' && !p.customSpecies.trim()) {
				memberFieldErrors = {};
				await revealValidation(t.petOtherSpeciesRequired);
				scrollToSection('pets');
				return;
			}
		}
		household.pets = syncPetsToHousehold(petItems);

		const payload: UnifiedRegistrationInput = {
			members,
			household: {
				...household,
				vehicles: showVehiclesAssets ? (household.vehicles ?? []) : [],
				assets:
					showVehiclesAssets && assetDescription.trim()
						? { description: assetDescription.trim(), image_url: null }
						: null
			},
			...(mode === 'create'
				? {
						join_household_id: joinHouseholdId || undefined,
						join_match_token: joinMatchToken || undefined
					}
				: {})
		};

		const result = unifiedRegistrationInputSchema.safeParse(payload);
		if (!result.success) {
			const mapped = mapZodIssues(result.error.issues);
			memberFieldErrors = mapped.memberErrors;
			const first = mapped.messages[0] ?? t.validationError;
			await revealValidation(first, mapped.messages);
			return;
		}

		if (channel === 'public') {
			const headPhone = members[0]?.phone?.trim();
			if (!headPhone || !/^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''))) {
				memberFieldErrors = { 0: { phone: t.headPhoneRequired } };
				await revealValidation(t.headPhoneRequired);
				return;
			}
		}

		if (mode === 'report-in') {
			const reportingCount = members.filter((m) => m.reporting_in).length;
			if (reportingCount === 0) {
				memberFieldErrors = {};
				await revealValidation('กรุณาเลือกสมาชิกอย่างน้อย 1 คนที่มารายงานตัวในรอบนี้');
				scrollToSection('members');
				return;
			}
		}

		formError = null;
		validationMessages = [];
		memberFieldErrors = {};
		try {
			await onsubmit(result.data as UnifiedRegistrationInput, {
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
	{#if formError}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5" role="alert">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">{t.validationSummaryTitle}</Alert.Title>
			<Alert.Description>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each validationMessages as msg (msg)}
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
		<!-- Left Column: Sticky Summary Card (hidden on mobile, sticky on lg+) -->
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
				onNavigate={(id) => scrollToSection(id as FormSectionId)}
			/>
		</aside>

		<!-- Right Column: Form Area (Full width on mobile, 8-col on lg+) -->
		<div class="space-y-6 lg:col-span-8">
			<!-- Top Progress Stepper (Mobile & Desktop) -->
			<UnifiedRegistrationStepper
				sections={formSectionNav}
				{activeSection}
				onNavigate={(id) => scrollToSection(id as FormSectionId)}
			/>

			<!-- ── Section 1: Address ─────────────────────────────────── -->
			<UnifiedRegistrationSection
				id="unified-address"
				title={t.sectionAddress}
				description={t.sectionAddressDesc}
				icon={Home}
			>
				<!-- ThaiD Action Button: Public Pre-Register -->
				{#if channel === 'public'}
					<ThaidActionButton disabled={fieldsLocked} onautofill={handleThaiDAutofill} />
				{/if}

				<!-- Quick Search & Merge Tool Bar (both Public and Onsite) -->
				{#if enableResidenceJoin}
					<div class="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-3">
						<div class="flex items-center justify-between gap-2">
							<p class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
								<Search class="size-3.5 text-primary" />
								<span>
									{channel === 'public'
										? 'ค้นหาครอบครัวด้วยเบอร์โทรศัพท์ (เพื่อเข้าร่วมบ้านเดิม)'
										: 'ค้นหาครอบครัวด้วยเบอร์โทรศัพท์'}
								</span>
							</p>
							{#if channel === 'onsite'}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={fieldsLocked}
									class="gap-1.5"
									onclick={() => (mergeDialogOpen = true)}
								>
									<GitMerge class="size-3.5" />
									ค้นหาเพื่อรวม 2 ครอบครัว
								</Button>
							{/if}
						</div>
						<div class="relative w-full">
							<Input
								type="tel"
								placeholder="ค้นหาด้วยเบอร์โทรศัพท์ของสมาชิกคนใดก็ได้ (เช่น 0812345678)"
								bind:value={searchPhoneQuery}
								disabled={fieldsLocked || hasJoinSelection}
								class="h-9 w-full pr-7 text-sm"
							/>
							{#if searchPhoneQuery}
								<button
									type="button"
									class="absolute top-2.5 right-2.5 text-xs text-muted-foreground hover:text-foreground"
									onclick={() => (searchPhoneQuery = '')}
									title="ล้างเบอร์โทร"
								>
									✕
								</button>
							{/if}
						</div>
						{#if channel === 'public'}
							<p class="text-2xs text-muted-foreground">
								หากมีสมาชิกในครอบครัวได้ลงทะเบียนไว้แล้ว
								สามารถพิมพ์เบอร์โทรศัพท์ของสมาชิกคนใดก็ได้เพื่อค้นหาและเข้าร่วมครอบครัวเดียวกัน
							</p>
						{/if}
					</div>
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
					loadMasterHousingTypes={channel !== 'public'}
					required={true}
					disabled={fieldsLocked || hasJoinSelection}
				/>

				{#if enableResidenceJoin}
					{#if hasJoinSelection}
						<div
							class="mt-3 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3"
							role="status"
							aria-live="polite"
						>
							<p class="text-sm font-semibold text-foreground">จะเข้าร่วมครอบครัวที่มีอยู่แล้ว</p>
							{#if joinSelectedSummary}
								<p class="text-xs text-muted-foreground">{joinSelectedSummary}</p>
							{/if}
							<p class="text-xs text-muted-foreground">
								สมาชิกใหม่จะถูกเพิ่มเข้าครอบครัวนี้ — หรือเลือกสร้างใหม่แทนได้
							</p>
							{#if selectedMatchChip?.shelter_code && selectedMatchChip.shelter_code !== shelterCode}
								<div
									class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-background/80 p-2 text-2xs"
								>
									<span class="text-muted-foreground">
										📍 ครอบครัวนี้อยู่ที่: <strong class="text-foreground"
											>{selectedMatchChip.shelter_name || selectedMatchChip.shelter_code}</strong
										>
										{#if !shelterCode}
											(คุณกำลังลงทะเบียนในคิวส่วนกลาง — ข้อมูลจะเชื่อมโยงข้ามศูนย์ให้อัตโนมัติ)
										{:else}
											(ข้อมูลจะเชื่อมโยงข้ามศูนย์พักพิงให้อัตโนมัติ)
										{/if}
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
											ต้องการย้ายไปศูนย์นี้ด้วย
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
								สร้างใหม่แทน
							</Button>
						</div>
					{:else if residenceSuggestPending}
						<div
							class="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
							role="status"
							aria-live="polite"
						>
							<Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
							กำลังค้นหาครอบครัวที่อยู่ตรงกัน...
						</div>
					{:else if channel === 'onsite' && residenceSuggestions.length > 0}
						<div class="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
							<p class="text-xs font-semibold text-foreground">
								พบครอบครัวที่อยู่ใกล้เคียง — เข้าร่วมได้ หรือสร้างใหม่ได้เสมอ
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
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={fieldsLocked}
											onclick={() => confirmOnsiteJoin(suggestion)}
										>
											เข้าร่วม
										</Button>
									</li>
								{/each}
							</ul>
							<Button
								type="button"
								size="sm"
								disabled={fieldsLocked}
								onclick={continueCreateDespiteSuggest}
							>
								สร้างใหม่
							</Button>
						</div>
					{:else if channel === 'public' && publicMatchChips.length > 0}
						<div class="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
							<p class="text-xs font-semibold text-foreground">
								พบครอบครัวที่ลงทะเบียนแล้ว — เข้าร่วมหรือสร้างใหม่
							</p>
							<ul class="space-y-2">
								{#each publicMatchChips as chip (chip.match_token)}
									<li class="rounded-lg border border-border/60 bg-card p-2.5">
										<div class="flex flex-wrap items-start justify-between gap-2">
											<div class="flex flex-col gap-1">
												<!-- Address line (no "บ้านตนเอง") -->
												<span class="text-sm font-medium text-foreground">
													{#if chip.address?.address_no}
														บ้านเลขที่ {chip.address.address_no}
														{chip.address.residence_landmark || ''}
													{:else}
														{chip.landmark?.trim() || 'ครอบครัวที่อยู่นี้'}
													{/if}
												</span>

												<!-- Masked primary contact -->
												{#if chip.primary_contact_masked}
													<span class="text-xs text-muted-foreground">
														ผู้ติดต่อหลัก: {chip.primary_contact_masked}
													</span>
												{/if}

												<!-- Shelter name -->
												{#if chip.shelter_name}
													<span class="text-2xs text-muted-foreground">
														อยู่ที่: {chip.shelter_name}
													</span>
												{/if}

												<!-- Member phone match confirmation badge -->
												{#if chip.matched_member_masked}
													<span
														class="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700"
													>
														<CheckCircle2 class="size-3" />
														ตรงกับเบอร์โทรศัพท์ของสมาชิก: {chip.matched_member_masked}
													</span>
												{/if}

												<!-- Member & pet count badges -->
												<div class="mt-0.5 flex flex-wrap gap-1.5">
													{#if chip.member_count && chip.member_count > 0}
														<span
															class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
														>
															<Users class="size-3" />
															{chip.member_count} สมาชิก
														</span>
													{/if}
													{#if chip.pets && chip.pets.length > 0}
														<span
															class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
														>
															<PawPrint class="size-3" />
															{chip.pets.length} สัตว์เลี้ยง
														</span>
													{/if}
												</div>
											</div>

											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={fieldsLocked}
												onclick={() => confirmPublicJoin(chip)}
											>
												เข้าร่วม
											</Button>
										</div>
									</li>
								{/each}
							</ul>
							<Button
								type="button"
								size="sm"
								disabled={fieldsLocked}
								onclick={continueCreateDespiteSuggest}
							>
								สร้างใหม่
							</Button>
						</div>
					{:else if residenceSuggestCheckedEmpty}
						<p class="mt-3 text-xs text-muted-foreground">
							{searchPhoneQuery.trim()
								? 'ไม่พบครอบครัวที่ตรงกับเบอร์โทรศัพท์นี้ — สามารถกรอกข้อมูลเพื่อลงทะเบียนครอบครัวใหม่ได้'
								: 'ไม่พบครอบครัวที่อยู่ตรงกัน — จะสร้างครอบครัวใหม่'}
						</p>
					{/if}
				{/if}
			</UnifiedRegistrationSection>

			<!-- ── Section 2: Members ─────────────────────────────────── -->
			<UnifiedRegistrationMembersSection
				bind:members
				{memberFieldErrors}
				pending={fieldsLocked}
				{mode}
				{channel}
				{memberPhotoUpload}
				{shelterCode}
				{membersSectionDesc}
				isJoiningExistingHousehold={hasJoinSelection}
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

			<div class="unified-reg-bottom-chrome">
				<div class="lg:hidden">
					<UnifiedRegistrationStickyNav
						sections={formSectionNav}
						{activeSection}
						ariaLabel={t.sectionNavAria}
						onNavigate={(id) => scrollToSection(id as FormSectionId)}
					/>
				</div>
				{#if !readOnly}
					<UnifiedRegistrationSubmitBar
						{pending}
						{submitDisabled}
						label={effectiveSubmitLabel}
						submittingLabel={t.submitting}
						align={submitAlign}
						sticky={false}
					/>
				{/if}
			</div>
		</div>
	</div>
</form>

<!-- Household Merge Dialog (onsite in-form absorb) -->
{#if channel === 'onsite'}
	<HouseholdMergeDialog
		bind:open={mergeDialogOpen}
		onAbsorbIntoForm={handleAbsorbHouseholdIntoForm}
	/>
{/if}

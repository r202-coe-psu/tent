<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Camera from '@lucide/svelte/icons/camera';
	import User from '@lucide/svelte/icons/user';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Home from '@lucide/svelte/icons/home';
	import Phone from '@lucide/svelte/icons/phone';
	import Package from '@lucide/svelte/icons/package';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import EvacueeHandoverSlipModal from './evacuee-handover-slip-modal.svelte';
	import HouseholdAddressFields from './forms/household-address-fields.svelte';
	import { EVACUEE_FORM_I18N } from './_constants/evacuee-form.i18n';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateHousehold,
		useUpdateEvacuee,
		usePatchHousehold,
		usePromoteReportIn
	} from '../application/queries';
	import { peopleRepository } from '../data/people.remote';
	import {
		formatPersonName,
		type EvacueeInput,
		type HouseholdInput,
		type HouseholdAsset,
		type Evacuee,
		type Household,
		type PetGroup,
		type HouseholdVehicle
	} from '../domain/people';
	import {
		sectionEVisibility,
		resolveHouseholdLeave,
		autoHouseholdLabel,
		hasMinimumResidence,
		defaultHouseholdChoice,
		isLeavingLinkedHousehold,
		filterJoinCandidatesByEvacueeQuery,
		type HouseholdChoice,
		type ResidenceFields
	} from '../domain/registration-shell';
	import {
		readResidenceSuggestDeps,
		residenceSuggestTick
	} from './residence-suggest-reactivity.svelte';
	import { buildSaveFailureReport, type SaveFailureReport } from '$lib/utils/errors';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const REG_FORM_ID = 'station1-registration-form';

	type FormSectionId = 'photo' | 'personal' | 'household' | 'emergency' | 'special' | 'sectionE';

	let {
		mode = 'walk-in',
		initialEvacuee = null,
		onsubmit,
		pending = false,
		onComplete,
		onHandover,
		onsaveerror,
		onDirtyChange,
		enableMedicalScreening: enableMedicalScreeningProp
	}: {
		mode?: 'walk-in' | 'report-in';
		initialEvacuee?: Evacuee | null;
		/** Walk-in: persist personal data only (no screening). */
		onsubmit?: (input: EvacueeInput, symptoms: string[]) => Promise<Evacuee> | Evacuee;
		pending?: boolean;
		onComplete?: (evacuee: Evacuee) => void;
		onHandover?: (evacuee: Evacuee, symptoms: string[]) => void;
		onsaveerror?: (report: SaveFailureReport) => void;
		onDirtyChange?: (dirty: boolean) => void;
		enableMedicalScreening?: boolean;
	} = $props();

	const shelterQuery = safeQuery(
		() => useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode()),
		{ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<
			typeof useShelter
		>
	);

	const isMedicalScreeningEnabled = $derived(
		enableMedicalScreeningProp !== undefined
			? enableMedicalScreeningProp
			: (shelterQuery.data?.feature_flags?.enable_medical_screening ?? false)
	);

	const t = $derived(getTranslation(EVACUEE_FORM_I18N, languageStore.current));

	const sectionEFlags = $derived({
		allow_pets: shelterQuery.data?.feature_flags?.allow_pets ?? false,
		allow_assets: shelterQuery.data?.feature_flags?.allow_assets ?? false,
		allow_vehicles: shelterQuery.data?.feature_flags?.allow_vehicles ?? false
	});

	let selectedHousehold = $state<Household | null>(null);
	let householdChoice = $state<HouseholdChoice>(
		untrack(() => defaultHouseholdChoice(Boolean(initialEvacuee?.household_id)))
	);
	let newHeadId = $state<string | null>(null);
	let showJoinPanel = $state(false);
	let joinSearchQuery = $state('');
	let residenceSuggestTimer: ReturnType<typeof setTimeout> | null = null;
	let residenceSuggestions = $state<Household[]>([]);
	/** True while debounce is waiting or households list is still loading for a complete Residence. */
	let residenceSuggestPending = $state(false);
	/** True after a completed suggest pass with zero matches (create mode only). */
	let residenceSuggestCheckedEmpty = $state(false);

	type ResidenceFormState = {
		address_no: string;
		village_no: string;
		subdistrict: string;
		district: string;
		province: string;
		postal_code: string;
	};

	function emptyResidence(): ResidenceFormState {
		return {
			address_no: '',
			village_no: '',
			subdistrict: '',
			district: '',
			province: '',
			postal_code: ''
		};
	}

	function residenceFromCard(ev: Evacuee | null | undefined): ResidenceFormState | null {
		const snap = ev?.card_snapshot;
		if (!snap) return null;
		const hasAny =
			snap.address_no || snap.province || snap.district || snap.subdistrict || snap.village_no;
		if (!hasAny) return null;
		const villageParts = [snap.village_no, snap.lane, snap.road].filter(Boolean).join(' ');
		return {
			address_no: snap.address_no ?? '',
			village_no: villageParts,
			subdistrict: snap.subdistrict ?? '',
			district: snap.district ?? '',
			province: snap.province ?? '',
			postal_code: snap.postal_code ?? ''
		};
	}

	function residenceFromHousehold(hh: Household): ResidenceFormState {
		return {
			address_no: hh.address_no ?? '',
			village_no: hh.village_no ?? '',
			subdistrict: hh.subdistrict ?? '',
			district: hh.district ?? '',
			province: hh.province ?? '',
			postal_code: hh.postal_code ?? ''
		};
	}

	function formatResidenceSummary(r: ResidenceFields): string {
		const parts = [
			r.address_no,
			r.village_no,
			r.subdistrict ? `ต.${r.subdistrict}` : '',
			r.district ? `อ.${r.district}` : '',
			r.province ? `จ.${r.province}` : '',
			r.postal_code
		].filter((p) => (p ?? '').toString().trim());
		return parts.join(' ') || '—';
	}

	const initialCardPrefill = untrack(() => residenceFromCard(initialEvacuee));
	let residenceForm = $state<ResidenceFormState>(
		untrack(() => initialCardPrefill ?? emptyResidence())
	);
	let cardPrefillNote = $state(Boolean(initialCardPrefill));

	function draftFromEvacuee(ev: Evacuee): Partial<EvacueeInput> {
		return {
			first_name: ev.first_name,
			last_name: ev.last_name,
			nickname: ev.nickname,
			gender: ev.gender,
			phone: ev.phone,
			person_id: ev.person_id,
			birth_year: ev.birth_year,
			age: ev.age,
			religion: ev.religion,
			country: ev.country,
			special_needs: ev.special_needs,
			emergency_contact: ev.emergency_contact,
			photo: ev.photo
		};
	}

	let registrationDraft = $state.raw<Partial<EvacueeInput> | null>(
		untrack(() => (initialEvacuee ? draftFromEvacuee(initialEvacuee) : null))
	);
	let registrationFacePhotoUrl = $state<string | null>(null);
	let baselineSnapshot = $state('');
	let isDirty = $state(false);
	let isSubmitting = $state(false);
	let shellError = $state<string | null>(null);
	let showHandoverSlip = $state(false);
	let handoverEvacuee = $state<Evacuee | null>(null);
	let activeSection = $state<FormSectionId>('photo');
	let scrollSpyPaused = $state(false);
	let sectionEData = $state<{
		pets: PetGroup[];
		assetDescription: string;
		vehicles: HouseholdVehicle[];
		disclaimerOk: boolean;
	}>({ pets: [], assetDescription: '', vehicles: [], disclaimerOk: true });

	const evacueesQuery = safeQuery(() => useEvacuees(), {
		data: [],
		isLoading: false,
		isError: false,
		refetch: () => {}
	} as unknown as ReturnType<typeof useEvacuees>);
	const householdsQuery = safeQuery(() => useHouseholds(), {
		data: [],
		isLoading: false,
		isError: false,
		refetch: () => {}
	} as unknown as ReturnType<typeof useHouseholds>);

	const createHouseholdMutation = safeQuery(() => useCreateHousehold(), {
		mutateAsync: async () => ({ _id: 'household:new' }),
		isPending: false
	} as unknown as ReturnType<typeof useCreateHousehold>);
	const updateHouseholdMutation = safeQuery(() => useUpdateHousehold(), {
		mutateAsync: async (args: unknown) => args,
		isPending: false
	} as unknown as ReturnType<typeof useUpdateHousehold>);
	const updateEvacueeMutation = safeQuery(() => useUpdateEvacuee(), {
		mutateAsync: async (args: unknown) => args,
		isPending: false
	} as unknown as ReturnType<typeof useUpdateEvacuee>);
	const patchHouseholdMutation = safeQuery(() => usePatchHousehold(), {
		mutateAsync: async (args: unknown) => args,
		isPending: false
	} as unknown as ReturnType<typeof usePatchHousehold>);
	const promoteMutation = safeQuery(() => usePromoteReportIn(), {
		mutateAsync: async (id: string) => ({ _id: id }) as Evacuee,
		isPending: false
	} as unknown as ReturnType<typeof usePromoteReportIn>);

	const linkedHousehold = $derived.by(() => {
		const hhId = initialEvacuee?.household_id;
		if (!hhId) return null;
		return (householdsQuery.data ?? []).find((h) => h._id === hhId) ?? null;
	});

	$effect(() => {
		if (linkedHousehold && (householdChoice === 'keep' || householdChoice === 'change_residence')) {
			selectedHousehold = linkedHousehold;
		}
	});

	$effect(() => {
		const households = householdsQuery.data ?? [];
		const deps = readResidenceSuggestDeps(
			householdChoice,
			residenceForm,
			households,
			Boolean(householdsQuery.isLoading) && households.length === 0
		);
		const tick = residenceSuggestTick(deps);

		if (residenceSuggestTimer) clearTimeout(residenceSuggestTimer);

		if (tick.kind === 'clear') {
			residenceSuggestions = [];
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = false;
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
		const choice = deps.choice;
		residenceSuggestTimer = setTimeout(() => {
			residenceSuggestions = matches as Household[];
			residenceSuggestPending = false;
			residenceSuggestCheckedEmpty = choice === 'create' && matches.length === 0;
		}, 350);
		return () => {
			if (residenceSuggestTimer) clearTimeout(residenceSuggestTimer);
		};
	});

	const joinCandidates = $derived(
		filterJoinCandidatesByEvacueeQuery(joinSearchQuery, evacueesQuery.data ?? [])
	);

	const sectionEVis = $derived(
		sectionEVisibility(sectionEFlags, {
			pets: linkedHousehold?.pets ?? selectedHousehold?.pets ?? [],
			assets: linkedHousehold?.assets ?? selectedHousehold?.assets ?? null,
			vehicles: linkedHousehold?.vehicles ?? selectedHousehold?.vehicles ?? []
		})
	);

	const sectionEHousehold = $derived(selectedHousehold ?? linkedHousehold);

	const householdMembers = $derived.by(() => {
		const hh = linkedHousehold;
		if (!hh) return [] as Evacuee[];
		return (evacueesQuery.data ?? []).filter((e) => e.household_id === hh._id);
	});

	const hasPriorHousehold = $derived(Boolean(linkedHousehold || initialEvacuee?.household_id));

	const leavingHousehold = $derived(isLeavingLinkedHousehold(hasPriorHousehold, householdChoice));

	const leavePreview = $derived.by(() => {
		if (!leavingHousehold || !linkedHousehold || !initialEvacuee) return null;
		return resolveHouseholdLeave({
			subjectId: initialEvacuee._id,
			headId: linkedHousehold.head_evacuee_id,
			memberIds: householdMembers.map((m) => m._id),
			newHeadId
		});
	});

	const formSectionNav = $derived.by(() => {
		const items: {
			id: FormSectionId;
			label: string;
			icon: typeof User;
		}[] = [
			{ id: 'photo', label: 'ภาพถ่ายใบหน้า', icon: Camera },
			{ id: 'personal', label: 'ข้อมูลประจำตัว', icon: User },
			{ id: 'household', label: 'ครอบครัว', icon: Home },
			{ id: 'emergency', label: 'ข้อมูลติดต่อฉุกเฉิน', icon: Phone },
			{ id: 'special', label: 'ความต้องการพิเศษ', icon: HeartPulse }
		];
		if (sectionEVis.showNavChip) {
			items.push({ id: 'sectionE', label: 'สัตว์เลี้ยง/ทรัพย์สิน', icon: Package });
		}
		return items;
	});

	function currentSnapshot(): string {
		return JSON.stringify({
			draft: registrationDraft,
			choice: householdChoice,
			selected: selectedHousehold?._id ?? null,
			residence: residenceForm,
			newHeadId,
			sectionE: sectionEData,
			joinSearch: joinSearchQuery,
			showJoinPanel
		});
	}

	$effect(() => {
		const snap = currentSnapshot();
		if (!baselineSnapshot) {
			baselineSnapshot = snap;
			isDirty = false;
			onDirtyChange?.(false);
			return;
		}
		isDirty = snap !== baselineSnapshot;
		onDirtyChange?.(isDirty);
	});

	onDestroy(() => {
		if (registrationFacePhotoUrl) URL.revokeObjectURL(registrationFacePhotoUrl);
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
					.map((s) => document.getElementById(`reg-section-${s.id}`))
					.filter((el): el is HTMLElement => el instanceof HTMLElement);

			const scrollRoot = findScrollParent(node);
			const observer = new IntersectionObserver(
				(entries) => {
					if (scrollSpyPaused) return;
					const visible = entries
						.filter((entry) => entry.isIntersecting)
						.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
					const target = visible[0]?.target;
					if (!(target instanceof HTMLElement) || !target.id.startsWith('reg-section-')) return;
					activeSection = target.id.replace('reg-section-', '') as FormSectionId;
				},
				{
					root: scrollRoot,
					rootMargin: '-72px 0px -55% 0px',
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
				}
			);

			for (const el of sectionNodes()) observer.observe(el);
			return () => observer.disconnect();
		};
	}

	function scrollToSection(sectionId: FormSectionId) {
		scrollSpyPaused = true;
		activeSection = sectionId;
		document.getElementById(`reg-section-${sectionId}`)?.scrollIntoView({
			behavior: 'smooth',
			block: 'start'
		});
		window.setTimeout(() => {
			scrollSpyPaused = false;
		}, 700);
	}

	function reportSaveFailure(
		err: unknown,
		opts: { rollbackNote?: string; docId?: string; docType?: string } = {}
	) {
		const report = buildSaveFailureReport(err, {
			summaryTh: 'บันทึกไม่สำเร็จ — ระบบปฏิเสธเอกสาร',
			shelterCode: getShelterCode(),
			...opts
		});
		onsaveerror?.(report);
		toast.error(t.toastSaveFailed);
	}

	function setHouseholdChoice(choice: HouseholdChoice) {
		householdChoice = choice;
		shellError = null;
		newHeadId = null;
		showJoinPanel = choice === 'join';
		if (choice === 'keep' || choice === 'change_residence') {
			if (linkedHousehold) {
				selectedHousehold = linkedHousehold;
				residenceForm = residenceFromHousehold(linkedHousehold);
			}
			cardPrefillNote = false;
		} else if (choice === 'join') {
			selectedHousehold = null;
			joinSearchQuery = '';
		} else if (choice === 'create') {
			selectedHousehold = null;
			if (!residenceForm.address_no && !residenceForm.province) {
				const fromCard = residenceFromCard(initialEvacuee);
				if (fromCard) {
					residenceForm = fromCard;
					cardPrefillNote = true;
				} else {
					residenceForm = emptyResidence();
					cardPrefillNote = false;
				}
			}
		}
	}

	function openJoinPanel() {
		setHouseholdChoice('join');
	}

	async function loadHouseholdDoc(id: string): Promise<Household | null> {
		try {
			const fresh = await peopleRepository().getHousehold(id);
			if (fresh) return fresh;
		} catch {
			/* fall through to list cache */
		}
		return (householdsQuery.data ?? []).find((h) => h._id === id) ?? null;
	}

	async function handleJoinSelect(evacuee: Evacuee) {
		const hhId = evacuee.household_id;
		if (!hhId) {
			toast.error(t.errorHouseholdNotFound);
			return;
		}
		const hh = await loadHouseholdDoc(hhId);
		if (!hh) {
			toast.error(t.errorHouseholdNotFound);
			return;
		}
		selectedHousehold = hh;
		householdChoice = 'join';
		showJoinPanel = true;
		shellError = null;
	}

	async function handleSuggestJoin(household: Household) {
		const hh = (await loadHouseholdDoc(household._id)) ?? household;
		selectedHousehold = hh;
		householdChoice = 'join';
		showJoinPanel = false;
		shellError = null;
	}

	function continueCreateDespiteSuggest() {
		selectedHousehold = null;
		householdChoice = 'create';
		showJoinPanel = false;
	}

	async function persistHouseholdLink(
		registeredEvacuee: Evacuee,
		pets: PetGroup[],
		assets: HouseholdAsset | null,
		vehicles: HouseholdVehicle[]
	): Promise<Evacuee> {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};

		if (leavingHousehold && linkedHousehold && leavePreview) {
			if (!leavePreview.ok) {
				throw new Error(
					leavePreview.reason === 'new_head_required'
						? 'กรุณาเลือกหัวหน้าครอบครัวคนใหม่ก่อนย้ายออก'
						: 'หัวหน้าคนใหม่ต้องเป็นสมาชิกในครอบครัวปัจจุบัน'
				);
			}
			if (leavePreview.transferHead) {
				await patchHouseholdMutation.mutateAsync({
					id: linkedHousehold._id,
					patch: { head_evacuee_id: leavePreview.newHeadId }
				});
			}
		}

		let householdId: string;

		if ((householdChoice === 'keep' || householdChoice === 'change_residence') && linkedHousehold) {
			householdId = linkedHousehold._id;
			const latestHousehold = await peopleRepository().getHousehold(linkedHousehold._id);
			if (!latestHousehold) throw new Error(t.errorHouseholdNotFound);
			const residencePatch =
				householdChoice === 'change_residence'
					? {
							address_no: residenceForm.address_no || null,
							village_no: residenceForm.village_no || null,
							subdistrict: residenceForm.subdistrict || null,
							district: residenceForm.district || null,
							province: residenceForm.province || null,
							postal_code: residenceForm.postal_code || null
						}
					: {};
			await updateHouseholdMutation.mutateAsync({
				...latestHousehold,
				...residencePatch,
				pets: sectionEVis.mode === 'editable' ? pets : latestHousehold.pets,
				assets:
					sectionEVis.mode === 'editable'
						? assets || latestHousehold.assets || null
						: latestHousehold.assets,
				vehicles:
					sectionEVis.mode === 'editable'
						? vehicles.length
							? vehicles
							: (latestHousehold.vehicles ?? [])
						: latestHousehold.vehicles,
				status: latestHousehold.status === 'pre_registered' ? 'arriving' : latestHousehold.status
			});
		} else if (householdChoice === 'join' && selectedHousehold) {
			householdId = selectedHousehold._id;
			const latestHousehold = await peopleRepository().getHousehold(selectedHousehold._id);
			if (!latestHousehold) throw new Error(t.errorHouseholdNotFound);
			await updateHouseholdMutation.mutateAsync({
				...latestHousehold,
				pets: sectionEVis.mode === 'editable' ? pets : latestHousehold.pets,
				assets:
					sectionEVis.mode === 'editable'
						? assets || latestHousehold.assets || null
						: latestHousehold.assets,
				vehicles:
					sectionEVis.mode === 'editable'
						? vehicles.length
							? vehicles
							: (latestHousehold.vehicles ?? [])
						: latestHousehold.vehicles,
				status: latestHousehold.status === 'pre_registered' ? 'arriving' : latestHousehold.status
			});
		} else if (householdChoice === 'create') {
			if (!hasMinimumResidence(residenceForm)) {
				throw new Error('กรุณากรอกที่อยู่ครอบครัวขั้นต่ำ (บ้านเลขที่ จังหวัด อำเภอ ตำบล)');
			}
			const householdLabel = autoHouseholdLabel(formatPersonName(registeredEvacuee));
			const householdInput: HouseholdInput = {
				label: householdLabel,
				head_evacuee_id: registeredEvacuee._id,
				status: 'arriving',
				municipality_zone: null,
				community: null,
				pets: sectionEVis.mode === 'editable' ? pets : [],
				assets: sectionEVis.mode === 'editable' ? assets : null,
				vehicles: sectionEVis.mode === 'editable' ? vehicles : [],
				notes: '',
				address_no: residenceForm.address_no || null,
				village_no: residenceForm.village_no || null,
				subdistrict: residenceForm.subdistrict || null,
				district: residenceForm.district || null,
				province: residenceForm.province || null,
				postal_code: residenceForm.postal_code || null
			};
			const res = await createHouseholdMutation.mutateAsync({ input: householdInput, ctx });
			householdId = res._id;
		} else {
			throw new Error(t.errorMustSelectHousehold);
		}

		return await updateEvacueeMutation.mutateAsync({
			...registeredEvacuee,
			household_id: householdId,
			current_stay: {
				...registeredEvacuee.current_stay,
				status: registeredEvacuee.current_stay.status,
				zone: null
			}
		});
	}

	async function finishCeremony(finished: Evacuee) {
		baselineSnapshot = currentSnapshot();
		isDirty = false;
		onDirtyChange?.(false);
		if (isMedicalScreeningEnabled) {
			handoverEvacuee = finished;
			showHandoverSlip = true;
			onHandover?.(finished, []);
		} else {
			onComplete?.(finished);
		}
	}

	function handleHandoverDone() {
		const finished = handoverEvacuee;
		showHandoverSlip = false;
		handoverEvacuee = null;
		if (finished) onComplete?.(finished);
	}

	async function handleValidatedPersonal(input: EvacueeInput) {
		if (isSubmitting) return;
		shellError = null;

		if (householdChoice === 'join' && !selectedHousehold) {
			shellError = 'กรุณาค้นหาและเลือกครอบครัวที่จะเข้าร่วม';
			scrollToSection('household');
			toast.error(shellError);
			return;
		}

		if (
			(householdChoice === 'create' || householdChoice === 'change_residence') &&
			!hasMinimumResidence(residenceForm)
		) {
			shellError = 'กรุณากรอกที่อยู่ครอบครัวขั้นต่ำ (บ้านเลขที่ จังหวัด อำเภอ ตำบล)';
			scrollToSection('household');
			toast.error(shellError);
			return;
		}

		if (leavingHousehold && leavePreview && !leavePreview.ok) {
			shellError =
				leavePreview.reason === 'new_head_required'
					? 'หัวหน้าครอบครัวต้องเลือกหัวหน้าคนใหม่ก่อนย้ายออก'
					: 'หัวหน้าคนใหม่ไม่ถูกต้อง';
			scrollToSection('household');
			toast.error(shellError);
			return;
		}

		if (sectionEVis.mode === 'editable' && !sectionEData.disclaimerOk) {
			shellError = 'กรุณายืนยันข้อความชี้แจงก่อนบันทึก';
			scrollToSection('sectionE');
			toast.error(shellError);
			return;
		}

		isSubmitting = true;
		let createdHouseholdId: string | null = null;
		let registeredEvacuee: Evacuee | null = null;
		let registrationSucceeded = false;

		try {
			const pets = sectionEData.pets.filter((p) => p.count > 0);
			let assets: HouseholdAsset | null = null;
			if (sectionEData.assetDescription) {
				assets = { description: sectionEData.assetDescription, image_url: null };
			}
			const vehicles = sectionEData.vehicles.map((v) => ({
				type: v.type,
				license_plate: v.license_plate?.trim() || null
			}));

			if (mode === 'report-in') {
				if (!initialEvacuee) throw new Error('ไม่พบข้อมูลผู้ประสบภัยสำหรับรายงานตัว');
				if (initialEvacuee.current_stay.status !== 'pre_registered') {
					throw new Error('รายงานตัวได้เฉพาะผู้ที่ลงทะเบียนล่วงหน้า (pre_registered)');
				}

				const updatedFields = await updateEvacueeMutation.mutateAsync({
					...initialEvacuee,
					...input,
					_id: initialEvacuee._id,
					_rev: initialEvacuee._rev,
					type: 'evacuee',
					household_id: initialEvacuee.household_id,
					current_stay: initialEvacuee.current_stay
				} as Evacuee);

				registeredEvacuee = await persistHouseholdLink(updatedFields, pets, assets, vehicles);
				registeredEvacuee = await promoteMutation.mutateAsync(registeredEvacuee._id);
				toast.success('รายงานตัวสำเร็จ — สถานะเป็น arriving');
				await finishCeremony(registeredEvacuee);
				return;
			}

			if (!onsubmit) throw new Error('ไม่ได้กำหนด onsubmit สำหรับ walk-in');

			const evacueeInputWithStatus: EvacueeInput = { ...input, status: 'arriving' };
			registeredEvacuee = await onsubmit(evacueeInputWithStatus, []);
			registrationSucceeded = true;

			const linked = await persistHouseholdLink(registeredEvacuee, pets, assets, vehicles);
			toast.success(t.toastSuccessRegistration);
			await finishCeremony(linked);
		} catch (err) {
			const repo = peopleRepository();
			if (createdHouseholdId) {
				await repo.compensateFailedHouseholdCreate(createdHouseholdId);
			}
			if (registrationSucceeded && registeredEvacuee && mode === 'walk-in') {
				await repo.compensateFailedEvacueeRegistration(registeredEvacuee._id);
				reportSaveFailure(err, {
					docId: registeredEvacuee._id,
					docType: 'evacuee',
					rollbackNote:
						'compensated: removed household (if created) + medical/evacuee from this submit when possible'
				});
			} else {
				reportSaveFailure(err);
			}
			shellError = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
		} finally {
			isSubmitting = false;
		}
	}

	function requestSave() {
		const form = document.getElementById(REG_FORM_ID);
		if (form instanceof HTMLFormElement) {
			form.requestSubmit();
			return;
		}
		toast.error('ไม่พบฟอร์มข้อมูลส่วนตัว');
	}

	async function onPersonalValidationError() {
		await tick();
		const order: FormSectionId[] = ['personal', 'emergency'];
		for (const id of order) {
			const invalid = document.querySelector<HTMLElement>(
				`#reg-section-${id} [aria-invalid="true"]`
			);
			if (invalid) {
				scrollToSection(id);
				requestAnimationFrame(() => {
					invalid.focus({ preventScroll: true });
				});
				return;
			}
		}
		scrollToSection('personal');
	}
</script>

<div class="space-y-4 pb-28">
	<nav class="sticky-section-nav z-20" aria-label="ส่วนของแบบฟอร์มลงทะเบียน">
		{#each formSectionNav as section (section.id)}
			{@const Icon = section.icon}
			<button
				type="button"
				class="touch-target shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors {activeSection ===
				section.id
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				aria-current={activeSection === section.id ? 'location' : undefined}
				onclick={() => scrollToSection(section.id)}
			>
				<Icon class="mr-1.5 inline size-4" />
				{section.label}
			</button>
		{/each}
	</nav>

	{#if shellError}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">ตรวจสอบข้อมูลก่อนบันทึก</Alert.Title>
			<Alert.Description>{shellError}</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="space-y-6" {@attach createScrollSpy()}>
		<RegistrationSection
			formId={REG_FORM_ID}
			hideActions={true}
			pending={isSubmitting || pending}
			initialInput={registrationDraft}
			ondraftchange={(input) => (registrationDraft = structuredClone(input))}
			bind:facePhotoUrl={registrationFacePhotoUrl}
			onsubmit={handleValidatedPersonal}
			onvalidationerror={onPersonalValidationError}
		>
			{#snippet afterPersonal()}
				<section id="reg-section-household" class="form-section-card scroll-mt-24 space-y-4">
					<header
						class="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3"
					>
						<div class="flex items-center gap-2">
							<Home class="size-5 text-primary" />
							<h2 class="text-base font-bold text-foreground">ครอบครัว</h2>
						</div>
						{#if !hasPriorHousehold || householdChoice === 'create' || householdChoice === 'join'}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="touch-target"
								onclick={openJoinPanel}
							>
								เข้าร่วม
							</Button>
						{/if}
					</header>

					{#if hasPriorHousehold}
						{#if linkedHousehold && (householdChoice === 'keep' || householdChoice === 'change_residence')}
							<div
								class="space-y-1 rounded-xl border border-success-border bg-success-muted/30 p-4 text-sm"
							>
								<p class="font-semibold text-foreground">{linkedHousehold.label}</p>
								<p class="text-muted-foreground">
									{formatResidenceSummary(residenceFromHousehold(linkedHousehold))}
								</p>
								{#if householdMembers.length}
									<p class="text-muted-foreground">
										สมาชิก: {householdMembers.map((m) => formatPersonName(m)).join(', ')}
									</p>
								{/if}
								{#if householdChoice === 'keep'}
									<p class="text-muted-foreground">คงสังกัดครอบครัวนี้หลังบันทึก</p>
								{/if}
							</div>
						{:else if !linkedHousehold && (householdChoice === 'keep' || householdChoice === 'change_residence')}
							<div
								class="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
							>
								กำลังโหลดข้อมูลครอบครัวที่เชื่อมอยู่…
							</div>
						{/if}

						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<button
								type="button"
								class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors {householdChoice ===
								'keep'
									? 'border-primary bg-primary-muted text-foreground'
									: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
								onclick={() => setHouseholdChoice('keep')}
							>
								คงครอบครัวเดิม
							</button>
							<button
								type="button"
								class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors {householdChoice ===
								'change_residence'
									? 'border-primary bg-primary-muted text-foreground'
									: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
								onclick={() => setHouseholdChoice('change_residence')}
							>
								เปลี่ยนที่อยู่
							</button>
							<button
								type="button"
								class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors {householdChoice ===
								'create'
									? 'border-primary bg-primary-muted text-foreground'
									: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
								onclick={() => setHouseholdChoice('create')}
							>
								ออกแล้วสร้างใหม่
							</button>
							<button
								type="button"
								class="touch-target rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors {householdChoice ===
								'join'
									? 'border-primary bg-primary-muted text-foreground'
									: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
								onclick={openJoinPanel}
							>
								เข้าร่วมครอบครัวอื่น
							</button>
						</div>
					{/if}

					{#if leavingHousehold && leavePreview && !leavePreview.ok && leavePreview.reason === 'new_head_required'}
						<div class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
							<p class="text-sm font-semibold text-foreground">
								คุณเป็นหัวหน้าครอบครัว — เลือกหัวหน้าคนใหม่ก่อนย้ายออก
							</p>
							<div class="flex flex-col gap-2">
								{#each householdMembers.filter((m) => m._id !== initialEvacuee?._id) as member (member._id)}
									<label
										class="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm {newHeadId ===
										member._id
											? 'border-primary bg-primary-muted'
											: ''}"
									>
										<input
											type="radio"
											name="new-head"
											value={member._id}
											checked={newHeadId === member._id}
											onchange={() => (newHeadId = member._id)}
										/>
										{formatPersonName(member)}
									</label>
								{/each}
							</div>
						</div>
					{/if}

					{#if householdChoice === 'join' || showJoinPanel}
						<div class="space-y-3 rounded-xl border border-border p-4">
							<div class="space-y-1.5">
								<Label for="join-search" class="text-xs font-semibold">
									ค้นหาผู้อพยพด้วยชื่อหรือเบอร์โทร
								</Label>
								<Input
									id="join-search"
									bind:value={joinSearchQuery}
									placeholder="ชื่อ หรือ เบอร์โทร"
									class="h-10"
								/>
							</div>
							{#if joinSearchQuery.trim() && joinCandidates.length === 0}
								<p class="text-sm text-muted-foreground">ไม่พบผู้อพยพที่มีครอบครัวในศูนย์นี้</p>
							{/if}
							{#if joinCandidates.length > 0}
								<ul class="space-y-2">
									{#each joinCandidates as candidate (candidate._id)}
										<li>
											<button
												type="button"
												class="touch-target w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary/40 {selectedHousehold?._id ===
												candidate.household_id
													? 'border-primary bg-primary-muted'
													: ''}"
												onclick={() => handleJoinSelect(candidate)}
											>
												<span class="font-semibold text-foreground"
													>{formatPersonName(candidate)}</span
												>
												{#if candidate.phone}
													<span class="text-muted-foreground"> · {candidate.phone}</span>
												{/if}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
							{#if selectedHousehold && householdChoice === 'join'}
								<div
									class="rounded-lg border border-success-border bg-success-muted/30 p-3 text-sm"
								>
									<p class="font-semibold">{selectedHousehold.label}</p>
									<p class="text-muted-foreground">
										{formatResidenceSummary(residenceFromHousehold(selectedHousehold))}
									</p>
								</div>
							{/if}
							{#if !hasPriorHousehold}
								<Button
									type="button"
									size="sm"
									variant="outline"
									onclick={() => {
										showJoinPanel = false;
										setHouseholdChoice('create');
									}}
								>
									กลับไปสร้างครอบครัวใหม่
								</Button>
							{/if}
						</div>
					{/if}

					{#if householdChoice === 'create' || householdChoice === 'change_residence'}
						<div class="space-y-3">
							{#if cardPrefillNote && householdChoice === 'create'}
								<p class="text-xs text-muted-foreground">
									เติมจากที่อยู่บนบัตรแล้ว — แก้ได้ก่อนบันทึก (ที่อยู่บัตรยังอยู่ที่ผู้อพยพ)
								</p>
							{/if}
							{#if householdChoice === 'change_residence'}
								<p class="text-sm text-muted-foreground">แก้ที่อยู่ครอบครัวนี้ (Residence)</p>
							{:else if !showJoinPanel}
								<p class="text-sm text-muted-foreground">
									กรอกที่อยู่สำหรับสร้างครอบครัวใหม่ (ชื่อครอบครัวสร้างอัตโนมัติ)
								</p>
							{/if}
							<HouseholdAddressFields
								bind:address_no={residenceForm.address_no}
								bind:village_no={residenceForm.village_no}
								bind:subdistrict={residenceForm.subdistrict}
								bind:district={residenceForm.district}
								bind:province={residenceForm.province}
								bind:postal_code={residenceForm.postal_code}
								required={true}
							/>

							{#if householdChoice === 'create' && residenceSuggestPending}
								<div
									class="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
									role="status"
									aria-live="polite"
								>
									<Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
									กำลังค้นหาครอบครัวที่อยู่ตรงกัน...
								</div>
							{:else if residenceSuggestions.length > 0 && householdChoice === 'create'}
								<div class="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
									<p class="text-xs font-semibold text-foreground">
										พบครอบครัวที่อยู่ใกล้เคียง — เข้าร่วมได้ หรือสร้างใหม่ได้เสมอ
									</p>
									<ul class="space-y-2">
										{#each residenceSuggestions as suggestion (suggestion._id)}
											<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
												<span>
													<span class="font-medium">{suggestion.label}</span>
													<span class="text-muted-foreground">
														· {formatResidenceSummary(suggestion)}
													</span>
												</span>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onclick={() => handleSuggestJoin(suggestion)}
												>
													เข้าร่วม
												</Button>
											</li>
										{/each}
									</ul>
									<Button type="button" size="sm" onclick={continueCreateDespiteSuggest}>
										สร้างครอบครัวใหม่ที่อยู่นี้
									</Button>
								</div>
							{:else if householdChoice === 'create' && residenceSuggestCheckedEmpty}
								<p class="text-xs text-muted-foreground">
									ไม่พบครอบครัวที่อยู่ตรงกันในศูนย์นี้ — จะสร้างครอบครัวใหม่
								</p>
							{/if}
						</div>
					{/if}
				</section>
			{/snippet}
		</RegistrationSection>

		{#if sectionEVis.mode !== 'hidden'}
			<section id="reg-section-sectionE" class="scroll-mt-24 space-y-4">
				{#if sectionEVis.mode === 'editable' && sectionEHousehold}
					<p class="text-xs text-muted-foreground">
						สัตว์เลี้ยง / ทรัพย์สิน / ยานพาหนะเป็นของทั้งครอบครัว —
						บันทึกแล้วสมาชิกทุกคนใช้ชุดเดียวกัน
					</p>
				{/if}
				{#key sectionEHousehold?._id ?? 'none'}
					<EvacueePetAssetVehicle
						household={sectionEHousehold}
						pending={isSubmitting}
						hideActions={true}
						readonly={sectionEVis.mode === 'readonly'}
						allowPets={sectionEVis.allow.pets || sectionEVis.mode === 'readonly'}
						allowAssets={sectionEVis.allow.assets || sectionEVis.mode === 'readonly'}
						allowVehicles={sectionEVis.allow.vehicles || sectionEVis.mode === 'readonly'}
						onDataChange={(data) => (sectionEData = data)}
					/>
				{/key}
			</section>
		{/if}
	</div>

	<div
		class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
	>
		<div class="mx-auto flex w-full max-w-5xl items-center justify-end gap-3">
			<Button
				type="button"
				disabled={isSubmitting || pending}
				class="touch-target h-auto min-w-40 px-6 py-3 text-base font-semibold"
				onclick={requestSave}
			>
				{#if isSubmitting || pending}
					<Loader2 class="mr-2 size-4 animate-spin" />
				{/if}
				บันทึก
			</Button>
		</div>
	</div>
</div>

{#if showHandoverSlip && handoverEvacuee}
	<EvacueeHandoverSlipModal
		show={showHandoverSlip}
		evacuee={handoverEvacuee}
		symptoms={[]}
		onClose={handleHandoverDone}
	/>
{/if}

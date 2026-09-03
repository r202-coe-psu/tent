<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type {
		EvacueeInput,
		HouseholdInput,
		HouseholdAsset,
		Evacuee,
		Household,
		PetGroup
	} from '../domain/people';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdRegisterForm from './household-register-form.svelte';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateHousehold,
		useUpdateEvacuee,
		peopleRepository,
		buildSaveFailureReport,
		formatPersonName,
		type SaveFailureReport
	} from '../index';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters/index.js';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import EvacueeHandoverSlipModal from './evacuee-handover-slip-modal.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_FORM_I18N } from './_constants/evacuee-form.i18n';
	import type { ScreeningDraft } from './evacuee-ewar-symptom.svelte';

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const shelterQuery = safeQuery(
		() => useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode()),
		{ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<
			typeof useShelter
		>
	);

	let {
		onsubmit,
		pending = false,
		step = $bindable(1),
		onComplete,
		onHandover,
		onsaveerror,
		enableMedicalScreening: enableMedicalScreeningProp
	}: {
		/** Persist personal data only — no screening doc. Symptoms arg kept for API compat (always []). */
		onsubmit: (input: EvacueeInput, symptoms: string[]) => Promise<Evacuee> | Evacuee;
		pending?: boolean;
		/** Station 1 wizard steps: 1 personal+special_needs, 2 household, 3 pets/assets */
		step?: 1 | 2 | 3;
		onComplete?: (evacuee: Evacuee) => void;
		onHandover?: (evacuee: Evacuee, symptoms: string[]) => void;
		onsaveerror?: (report: SaveFailureReport) => void;
		enableMedicalScreening?: boolean;
	} = $props();

	const isMedicalScreeningEnabled = $derived(
		enableMedicalScreeningProp !== undefined
			? enableMedicalScreeningProp
			: (shelterQuery.data?.feature_flags?.enable_medical_screening ?? false)
	);

	const t = $derived(getTranslation(EVACUEE_FORM_I18N, languageStore.current));
	const totalSteps = 3;
	const STEPS = $derived([
		{
			title: 'ข้อมูลผู้ประสบภัยและความต้องการพิเศษ',
			short: 'ข้อมูลผู้ประสบภัย',
			description: 'กรอกข้อมูลยืนยันตัวตน ผู้ติดต่อฉุกเฉิน และกลุ่มเปราะบาง'
		},
		t.steps[3],
		t.steps[4]
	]);
	const effectiveSteps = $derived(STEPS);
	const currentStep = $derived(effectiveSteps[step - 1] ?? effectiveSteps[0]);

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

	const selectedSymptoms = new SvelteSet<string>();
	let screeningDraft = $state<ScreeningDraft>({
		medical_conditions: [],
		medical_medications: [],
		medical_allergies: [],
		special_needs: [],
		medical_note: ''
	});
	let newlyRegisteredEvacuee = $state<Evacuee | null>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);
	let zoneError = $state<string | null>(null);

	let showHandoverSlip = $state(false);
	let handoverEvacuee = $state<Evacuee | null>(null);
	let handoverSymptoms = $state<string[]>([]);

	let pendingEvacueeInput = $state<EvacueeInput | null>(null);
	let pendingSymptoms = $state<string[]>([]);
	let registrationDraft = $state.raw<Partial<EvacueeInput> | null>(null);
	let registrationFacePhotoUrl = $state<string | null>(null);
	let registrationDraftActive = $state(step === 1);

	let selectedHousehold = $state<Household | null>(null);
	let isCreatingNewHousehold = $state(false);
	let newHouseholdAddress = $state<Partial<HouseholdInput> | null>(null);

	let tempEvacuee = $derived.by((): Evacuee | null => {
		if (!pendingEvacueeInput) return null;
		return {
			_id: 'temp-new-evacuee',
			...pendingEvacueeInput,
			current_stay: {
				status: 'active',
				zone: null
			}
		} as Evacuee;
	});

	let combinedEvacuees = $derived.by(() => {
		const list = evacueesQuery.data ? [...evacueesQuery.data] : [];
		if (tempEvacuee) {
			list.push(tempEvacuee);
		}
		return list;
	});

	// Fetch data for HouseholdRegisterForm
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
	const householdDataLoading = $derived(evacueesQuery.isLoading || householdsQuery.isLoading);
	const householdDataError = $derived(evacueesQuery.isError || householdsQuery.isError);

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

	let activeDraftEvacuee = $state<Evacuee | null>(null);
	let topAnchorRef = $state<HTMLElement | null>(null);

	async function scrollToTop() {
		if (typeof window === 'undefined') return;
		await tick();
		requestAnimationFrame(() => {
			if (topAnchorRef) {
				topAnchorRef.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
			window.scrollTo({ top: 0, behavior: 'smooth' });
			document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
			document.body.scrollTo({ top: 0, behavior: 'smooth' });

			const scrollContainers = document.querySelectorAll(
				'.overflow-y-auto, .overflow-auto, [class*="overflow-y-auto"], main'
			);
			scrollContainers.forEach((el) => {
				el.scrollTo({ top: 0, behavior: 'smooth' });
			});
		});
	}

	let mounted = false;
	$effect(() => {
		if (!mounted) {
			mounted = true;
			return;
		}
		if (step >= 1) scrollToTop();
	});

	function goToStep(next: 1 | 2 | 3) {
		zoneError = null;
		if (next === 1) registrationDraftActive = true;
		step = next;
		scrollToTop();
	}

	function clearRegistrationDraft() {
		if (registrationFacePhotoUrl) URL.revokeObjectURL(registrationFacePhotoUrl);
		registrationDraft = null;
		registrationFacePhotoUrl = null;
		activeDraftEvacuee = null;
		screeningDraft = {
			medical_conditions: [],
			medical_medications: [],
			medical_allergies: [],
			special_needs: [],
			medical_note: ''
		};
		selectedSymptoms.clear();
	}

	onDestroy(() => {
		if (registrationFacePhotoUrl) URL.revokeObjectURL(registrationFacePhotoUrl);
	});

	function retryHouseholdData() {
		evacueesQuery.refetch();
		householdsQuery.refetch();
	}

	function handleRegistrationSubmit(input: EvacueeInput) {
		const combinedSpecialNeeds = Array.from(
			new Set([...(screeningDraft.special_needs ?? []), ...(input.special_needs ?? [])])
		);
		const merged: EvacueeInput = {
			...input,
			special_needs: combinedSpecialNeeds
		};
		screeningDraft.special_needs = combinedSpecialNeeds;
		registrationDraft = structuredClone(merged);
		if (activeDraftEvacuee) {
			pendingEvacueeInput = {
				...merged,
				...(activeDraftEvacuee ? { draft_id: activeDraftEvacuee._id } : {})
			} as EvacueeInput;
		} else {
			pendingEvacueeInput = merged;
		}
		pendingSymptoms = [];
		goToStep(2);
	}

	function handleHouseholdSelect(household: Household) {
		selectedHousehold = household;
		isCreatingNewHousehold = false;
		newHouseholdAddress = null;
	}

	function handleHouseholdRegisterSubmit(addressInput: Partial<HouseholdInput>) {
		newHouseholdAddress = addressInput;
		isCreatingNewHousehold = true;
		selectedHousehold = null;
		goToStep(3);
	}

	async function handleFinalSubmit(petAssetVehicleData: {
		pets: PetGroup[];
		assetDescription: string;
		vehicles: { type: 'car' | 'motorcycle' | 'other'; license_plate: string | null }[];
	}) {
		if (isSubmittingHousehold) return;
		if (!selectedHousehold && (!isCreatingNewHousehold || !newHouseholdAddress)) {
			toast.error(t.toastSelectHouseholdFirst);
			goToStep(2);
			return;
		}
		isSubmittingHousehold = true;

		let registrationSucceeded = false;
		let createdHouseholdId: string | null = null;
		let registeredEvacuee: Evacuee | null = newlyRegisteredEvacuee;
		const savedPendingInput = pendingEvacueeInput;
		const savedPendingSymptoms = pendingSymptoms;

		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};

			// 1. Register evacuee (Station 1 — arriving, no screening/zone)
			if (pendingEvacueeInput) {
				const evacueeInputWithStatus: EvacueeInput = {
					...pendingEvacueeInput,
					status: 'arriving'
				};
				registeredEvacuee = await onsubmit(evacueeInputWithStatus, []);
				registrationSucceeded = true;
				newlyRegisteredEvacuee = registeredEvacuee;
				pendingEvacueeInput = null;
				pendingSymptoms = [];
			}

			if (!registeredEvacuee) {
				throw new Error(t.errorMissingEvacueeData);
			}

			// 2. Map pets — a household may bring several (schema pets[])
			const pets = petAssetVehicleData.pets.filter((p) => p.count > 0);

			// 3. Map assets
			let assets: HouseholdAsset | null = null;
			if (petAssetVehicleData.assetDescription) {
				assets = {
					description: petAssetVehicleData.assetDescription,
					image_url: null
				};
			}

			// 4. Map vehicles (household may bring several — schema vehicles[])
			const vehicles = petAssetVehicleData.vehicles.map((v) => ({
				type: v.type,
				license_plate: v.license_plate?.trim() || null
			}));

			let householdId: string | null = null;

			// 5. Create or Join household
			if (selectedHousehold) {
				householdId = selectedHousehold._id;

				const latestHousehold = await peopleRepository().getHousehold(selectedHousehold._id);
				if (!latestHousehold) throw new Error(t.errorHouseholdNotFound);

				await updateHouseholdMutation.mutateAsync({
					...latestHousehold,
					label: latestHousehold.label || `ครอบครัวผู้ประสบภัย ${latestHousehold._id}`,
					// Step 3 edits the household-level collections in place.
					pets,
					assets: assets || latestHousehold.assets || null,
					vehicles,
					status: 'arriving'
				});
			} else if (isCreatingNewHousehold) {
				const addr = newHouseholdAddress || {};
				const householdLabel = `ครอบครัว${formatPersonName(registeredEvacuee)}`;

				const householdInput: HouseholdInput = {
					label: householdLabel,
					head_evacuee_id: registeredEvacuee._id,
					status: 'arriving',
					municipality_zone: null,
					community: null,
					pets: pets,
					assets: assets,
					vehicles: vehicles,
					notes: '',
					address_no: addr.address_no || null,
					village_no: addr.village_no || null,
					subdistrict: addr.subdistrict || null,
					district: addr.district || null,
					province: addr.province || null,
					postal_code: addr.postal_code || null
				};

				const res = await createHouseholdMutation.mutateAsync({ input: householdInput, ctx });
				createdHouseholdId = res._id;
				householdId = res._id;
			}

			// 6. Link evacuee to household
			if (!householdId) {
				throw new Error(t.errorMustSelectHousehold);
			}

			const updated = await updateEvacueeMutation.mutateAsync({
				...registeredEvacuee,
				household_id: householdId,
				current_stay: {
					...registeredEvacuee.current_stay,
					status: 'arriving',
					zone: null
				}
			});
			newlyRegisteredEvacuee = updated;
			toast.success(t.toastSuccessRegistration);

			// Station 1 never zones — handover slip when medical flag on, then Person QR via onComplete
			if (isMedicalScreeningEnabled) {
				handoverEvacuee = updated;
				handoverSymptoms = [];
				showHandoverSlip = true;
				onHandover?.(updated, []);
			} else {
				handleRegistrationDone(updated);
			}
		} catch (err) {
			const repo = peopleRepository();
			if (createdHouseholdId) {
				await repo.compensateFailedHouseholdCreate(createdHouseholdId);
			}

			if (registrationSucceeded && registeredEvacuee) {
				// Household/link failed after a successful registration unit — roll that unit back.
				await repo.compensateFailedEvacueeRegistration(registeredEvacuee._id);
				newlyRegisteredEvacuee = null;
				pendingEvacueeInput = savedPendingInput;
				pendingSymptoms = savedPendingSymptoms;
				reportSaveFailure(err, {
					docId: registeredEvacuee._id,
					docType: 'evacuee',
					rollbackNote:
						'compensated: removed household (if created) + medical/evacuee from this submit when possible'
				});
			} else if (savedPendingInput) {
				// Parent onsubmit already compensated + reported; restore draft for retry.
				newlyRegisteredEvacuee = null;
				pendingEvacueeInput = savedPendingInput;
				pendingSymptoms = savedPendingSymptoms;
			} else {
				reportSaveFailure(err);
			}
		} finally {
			isSubmittingHousehold = false;
		}
	}

	function handleRegistrationDone(finished: Evacuee) {
		goToStep(1);
		clearRegistrationDraft();
		registrationDraftActive = false;
		newlyRegisteredEvacuee = null;
		selectedHousehold = null;
		isCreatingNewHousehold = false;
		newHouseholdAddress = null;
		onComplete?.(finished);
	}

	function handleHandoverDone() {
		const finished = handoverEvacuee ?? newlyRegisteredEvacuee;
		showHandoverSlip = false;
		handoverEvacuee = null;
		handoverSymptoms = [];
		if (finished) {
			handleRegistrationDone(finished);
		}
	}
</script>

<div bind:this={topAnchorRef} class="scroll-mt-6"></div>

<!-- ── Step progress ──────────────────────────────────────────────────────────── -->
<div class="mb-6 space-y-3">
	<div class="sm:hidden">
		<p class="text-xs font-medium text-muted-foreground">{t.stepOf(step, totalSteps)}</p>
		<h2 class="text-lg font-semibold">{currentStep.title}</h2>
		<p class="text-sm text-muted-foreground">{currentStep.description}</p>
		<div
			class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
			role="progressbar"
			aria-valuenow={step}
			aria-valuemin={1}
			aria-valuemax={totalSteps}
			aria-label={t.progressAria}
		>
			<div
				class="h-full rounded-full bg-primary transition-all"
				style:width={`${(step / totalSteps) * 100}%`}
			></div>
		</div>
	</div>

	<div class="hidden sm:block">
		<div class="mb-4 flex items-start">
			{#each effectiveSteps as meta, i (meta.short)}
				{@const s = i + 1}
				<div class="flex flex-1 flex-col items-center gap-2">
					<div class="flex w-full items-center">
						<div
							class="h-0.5 flex-1 transition-colors {s === 1
								? 'invisible'
								: step >= s
									? 'bg-green-500'
									: 'bg-border'}"
						></div>
						<div
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
							s
								? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
								: step > s
									? 'bg-green-600 text-white'
									: 'bg-muted text-muted-foreground'}"
							aria-current={step === s ? 'step' : undefined}
						>
							{step > s ? '✓' : s}
						</div>
						<div
							class="h-0.5 flex-1 transition-colors {s === totalSteps
								? 'invisible'
								: step > s
									? 'bg-green-500'
									: 'bg-border'}"
						></div>
					</div>
					<span
						class="text-center text-xs leading-tight font-medium {step === s
							? 'text-foreground'
							: step > s
								? 'text-green-700'
								: 'text-muted-foreground'}"
					>
						{meta.short}
					</span>
				</div>
			{/each}
		</div>
		<div>
			<h2 class="text-xl font-semibold">{currentStep.title}</h2>
			<p class="text-sm text-muted-foreground">{currentStep.description}</p>
		</div>
	</div>
</div>

{#if zoneError}
	<Alert.Root variant="destructive" class="mb-4 border-destructive/40 bg-destructive/5">
		<CircleAlert class="size-4" />
		<Alert.Title class="font-semibold">{t.zoneErrorTitle}</Alert.Title>
		<Alert.Description class="space-y-3">
			<p>{zoneError}</p>
			<Button type="button" variant="outline" size="sm" onclick={() => (zoneError = null)}>
				{t.closeAlert}
			</Button>
		</Alert.Description>
	</Alert.Root>
{/if}

{#if registrationDraftActive || step === 1}
	<div class:hidden={step !== 1}>
		<RegistrationSection
			onsubmit={handleRegistrationSubmit}
			pending={isSubmittingEvacuee || pending}
			initialInput={{
				...registrationDraft,
				special_needs: registrationDraft?.special_needs?.length
					? registrationDraft.special_needs
					: (screeningDraft.special_needs ?? [])
			}}
			ondraftchange={(input) => (registrationDraft = structuredClone(input))}
			bind:facePhotoUrl={registrationFacePhotoUrl}
		/>
	</div>
{/if}

{#if step === 2}
	<div class="space-y-6">
		<Alert.Root class="border-primary/30 bg-primary/5">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">{t.householdAlertTitle}</Alert.Title>
			<Alert.Description>
				{t.householdAlertDesc}
			</Alert.Description>
		</Alert.Root>

		{#if householdDataLoading}
			<div class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
				<Loader2 class="size-4 animate-spin" />
				{t.householdLoading}
			</div>
		{:else}
			{#if householdDataError}
				<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5">
					<CircleAlert class="size-4" />
					<Alert.Title class="font-semibold">{t.householdLoadErrorTitle}</Alert.Title>
					<Alert.Description class="space-y-3">
						<p>{t.householdLoadErrorDesc}</p>
						<Button type="button" variant="outline" size="sm" onclick={retryHouseholdData}>
							{t.retry}
						</Button>
					</Alert.Description>
				</Alert.Root>
			{/if}

			<HouseholdRegisterForm
				allEvacuees={combinedEvacuees}
				households={householdsQuery.data ?? []}
				initialAddress={newHouseholdAddress}
				onsubmit={handleHouseholdRegisterSubmit}
				onselect={handleHouseholdSelect}
				oncontinue={() => goToStep(3)}
				onback={() => goToStep(1)}
				pending={isSubmittingHousehold}
				bind:showNewHouseholdForm={isCreatingNewHousehold}
			/>
		{/if}
	</div>
{:else if step === 3}
	<EvacueePetAssetVehicle
		household={selectedHousehold}
		pending={isSubmittingHousehold}
		onBack={() => goToStep(2)}
		onNext={handleFinalSubmit}
	/>
{/if}

{#if showHandoverSlip && handoverEvacuee}
	<EvacueeHandoverSlipModal
		show={showHandoverSlip}
		evacuee={handoverEvacuee}
		symptoms={handoverSymptoms}
		onClose={handleHandoverDone}
	/>
{/if}

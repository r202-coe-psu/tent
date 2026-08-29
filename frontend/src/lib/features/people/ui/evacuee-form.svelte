<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type {
		EvacueeInput,
		HouseholdInput,
		HouseholdAsset,
		Evacuee,
		Household,
		PetGroup
	} from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdRegisterForm from './household-register-form.svelte';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import EvacueeSelectZone from './evacuee-select-zone.svelte';
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
		useCheckInEvacuee,
		peopleRepository,
		buildSaveFailureReport,
		type SaveFailureReport
	} from '../index';
	import { getShelterCode } from '$lib/db/shelter';

	const STEPS = [
		{
			title: 'ตรวจสอบประวัติการลงทะเบียน',
			short: 'ตรวจสอบประวัติ',
			description: 'ค้นหาด้วยเลขบัตรประชาชน, เบอร์โทรศัพท์ หรือชื่อ-นามสกุล ก่อนลงทะเบียนใหม่'
		},
		{
			title: 'ส่วนประเมินอาการเจ็บป่วยและกลุ่มอาการเฝ้าระวัง (EWAR Symptoms)',
			short: 'ประเมินอาการ',
			description: 'โปรดสังเกตอาการหรือสอบถามผู้ประสบภัยก่อนเริ่มลงทะเบียน หากพบอาการให้แจ้งเตือน'
		},
		{
			title: 'ข้อมูลผู้ประสบภัย (Registration)',
			short: 'ข้อมูลผู้ประสบภัย',
			description: 'กรอกข้อมูลพื้นฐานและประเมินสถานะ'
		},
		{
			title: 'หน้าค้นหาครัวเรือน (Head of Household)',
			short: 'ข้อมูลครัวเรือน',
			description:
				'เลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ (ผู้ที่มาเพียงคนเดียวให้สร้างครัวเรือน 1 คน)'
		},
		{
			title: 'ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)',
			short: 'ทรัพย์สินและสัตว์เลี้ยง',
			description: 'บันทึกข้อมูลสัมภาระ ยานพาหนะ สัตว์เลี้ยง และสถานะบ้าน'
		},
		{
			title: 'จัดสรรพื้นที่ (Zoning)',
			short: 'จัดสรรพื้นที่',
			description: 'เลือกโซนพักพิงและพิมพ์สลิปข้อปฏิบัติ'
		}
	] as const;

	let {
		onsubmit,
		pending = false,
		step = $bindable(1),
		onComplete,
		onsaveerror
	}: {
		onsubmit: (input: EvacueeInput, symptoms: string[]) => Promise<Evacuee> | Evacuee;
		pending?: boolean;
		step?: 1 | 2 | 3 | 4 | 5 | 6;
		onComplete?: (evacuee: Evacuee) => void;
		onsaveerror?: (report: SaveFailureReport) => void;
	} = $props();

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
		toast.error('บันทึกไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน');
	}

	const selectedSymptoms = new SvelteSet<string>();
	let isHealthy = $state(false);
	let newlyRegisteredEvacuee = $state<Evacuee | null>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);
	let zoneError = $state<string | null>(null);

	const currentStep = $derived(STEPS[step - 1]);

	let pendingEvacueeInput = $state<EvacueeInput | null>(null);
	let pendingSymptoms = $state<string[]>([]);
	let registrationDraft = $state.raw<Partial<EvacueeInput> | null>(null);
	let registrationFacePhotoUrl = $state<string | null>(null);
	let registrationDraftActive = $state(step === 3);

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
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const householdDataLoading = $derived(evacueesQuery.isLoading || householdsQuery.isLoading);
	const householdDataError = $derived(evacueesQuery.isError || householdsQuery.isError);

	const createHouseholdMutation = useCreateHousehold();
	const updateHouseholdMutation = useUpdateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();
	const checkInMutation = useCheckInEvacuee();

	let activeDraftEvacuee = $state<Evacuee | null>(null);

	function goToStep(next: 1 | 2 | 3 | 4 | 5 | 6) {
		zoneError = null;
		if (next === 3) registrationDraftActive = true;
		step = next;
	}

	function handleSelectDraft(draft: Evacuee) {
		activeDraftEvacuee = draft;
		const card = draft.card_snapshot;

		// 1. Populate Personal Info for Step 3
		registrationDraft = {
			first_name: draft.first_name || card?.first_name_th || '',
			last_name: draft.last_name || card?.last_name_th || '',
			gender: draft.gender || card?.gender || 'other',
			phone: draft.phone ?? null,
			birth_year: draft.birth_year ?? (card?.birth_year_ce ? card.birth_year_ce + 543 : undefined),
			age: draft.age ?? card?.age ?? undefined,
			person_id:
				draft.person_id ??
				(card?.citizen_id ? { cardType: 'national_id', number: card.citizen_id } : undefined),
			country: draft.country || 'THAILAND',
			religion: draft.religion || 'buddhist',
			special_needs: draft.special_needs || [],
			photo: draft.photo || card?.photo_base64 || null,
			card_snapshot: card || null
		};

		if (draft.photo || card?.photo_base64) {
			registrationFacePhotoUrl = draft.photo || card?.photo_base64 || null;
		}

		// 2. Populate Address for Step 4 (Household)
		if (card) {
			newHouseholdAddress = {
				address_no: card.address_no || null,
				village_no: card.village_no ? `หมู่ ${card.village_no}` : null,
				subdistrict: card.subdistrict || null,
				district: card.district || null,
				province: card.province || null,
				postal_code: card.postal_code || null
			};
			isCreatingNewHousehold = true;
		}

		// 3. Start at Step 2 (EWAR Symptoms)
		goToStep(2);
		toast.info(
			`โหลดข้อมูลจากบัตร "${draft.first_name} ${draft.last_name}" แล้ว — กรุณาคัดกรองสุขภาพ (Step 1)`
		);
	}

	function clearRegistrationDraft() {
		if (registrationFacePhotoUrl) URL.revokeObjectURL(registrationFacePhotoUrl);
		registrationDraft = null;
		registrationFacePhotoUrl = null;
		activeDraftEvacuee = null;
	}

	onDestroy(() => {
		if (registrationFacePhotoUrl) URL.revokeObjectURL(registrationFacePhotoUrl);
	});

	function retryHouseholdData() {
		evacueesQuery.refetch();
		householdsQuery.refetch();
	}

	function handleRegistrationSubmit(input: EvacueeInput) {
		registrationDraft = structuredClone(input);
		if (activeDraftEvacuee) {
			pendingEvacueeInput = {
				...input,
				...(activeDraftEvacuee ? { draft_id: activeDraftEvacuee._id } : {})
			} as EvacueeInput;
		} else {
			pendingEvacueeInput = input;
		}
		pendingSymptoms = Array.from(selectedSymptoms);
		selectedSymptoms.clear();
		isHealthy = false;
		goToStep(4);
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
		goToStep(5);
	}

	async function handleFinalSubmit(petAssetVehicleData: {
		pets: PetGroup[];
		assetDescription: string;
		vehicles: { type: 'car' | 'motorcycle' | 'other'; license_plate: string | null }[];
	}) {
		if (isSubmittingHousehold) return;
		if (!selectedHousehold && (!isCreatingNewHousehold || !newHouseholdAddress)) {
			toast.error('กรุณาเลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ก่อนดำเนินการต่อ');
			goToStep(4);
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

			// 1. Register evacuee (+ screening via parent onsubmit unit)
			if (pendingEvacueeInput) {
				registeredEvacuee = await onsubmit(pendingEvacueeInput, pendingSymptoms);
				registrationSucceeded = true;
				newlyRegisteredEvacuee = registeredEvacuee;
				pendingEvacueeInput = null;
				pendingSymptoms = [];
			}

			if (!registeredEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัยที่กำลังลงทะเบียน');
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
				if (!latestHousehold) throw new Error('ไม่พบครัวเรือนในระบบ');

				await updateHouseholdMutation.mutateAsync({
					...latestHousehold,
					label: latestHousehold.label || `ครอบครัวผู้ประสบภัย ${latestHousehold._id}`,
					// Step 5 edits the household-level collections in place.
					pets,
					assets: assets || latestHousehold.assets || null,
					vehicles
				});
			} else if (isCreatingNewHousehold) {
				const addr = newHouseholdAddress || {};
				const householdLabel = `ครอบครัว${registeredEvacuee.first_name} ${registeredEvacuee.last_name}`;

				const householdInput: HouseholdInput = {
					label: householdLabel,
					head_evacuee_id: registeredEvacuee._id,
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
				throw new Error('ต้องเลือกหรือสร้างครัวเรือนก่อนลงทะเบียนผู้ประสบภัย');
			}

			const updated = await updateEvacueeMutation.mutateAsync({
				...registeredEvacuee,
				household_id: householdId
			});
			newlyRegisteredEvacuee = updated;
			toast.success('ลงทะเบียนผู้ประสบภัยและครัวเรือนสำเร็จ');

			// Go to step 6 (Zoning)
			goToStep(6);
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

	async function handleZoneSubmit(zone: string) {
		zoneError = null;

		if (!newlyRegisteredEvacuee) {
			zoneError = 'ไม่พบข้อมูลผู้ประสบภัยที่กำลังคัดแยก กรุณาย้อนกลับไปตรวจสอบขั้นตอนก่อนหน้า';
			toast.error('จัดสรรพื้นที่ไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน');
			return;
		}

		try {
			// Fetch the latest evacuee document to avoid CouchDB MVCC revision conflicts
			const latestEvacuee = await peopleRepository().getEvacuee(newlyRegisteredEvacuee._id);
			if (!latestEvacuee) {
				zoneError =
					'ไม่พบข้อมูลผู้ประสบภัยในระบบ — ข้อมูลอาจยังไม่ถูกบันทึกครบ กรุณาย้อนกลับหรือลองใหม่อีกครั้ง';
				toast.error('จัดสรรพื้นที่ไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน');
				return;
			}

			// Check-in writes an append-only movement first, then applies current_stay —
			// occupancy views and movement history depend on the movement stream
			// (current_stay is only a snapshot, schema.md §1.1).
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};
			const finishedEvacuee = await checkInMutation.mutateAsync({
				evacuee: latestEvacuee,
				ctx,
				zone
			});
			toast.success('บันทึกข้อมูลและจัดสรรพื้นที่สำเร็จ');

			// Reset internal state
			goToStep(1);
			clearRegistrationDraft();
			registrationDraftActive = false;
			newlyRegisteredEvacuee = null;
			selectedHousehold = null;
			isCreatingNewHousehold = false;
			newHouseholdAddress = null;

			// Notify parent to show the success/wristband screen
			onComplete?.(finishedEvacuee);
		} catch (err) {
			console.error('[EvacueeForm] Zone assignment check-in error:', err);
			const detail = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกโซน';
			zoneError = `จัดสรรพื้นที่ไม่สำเร็จ (${detail}) — กรุณาลองเลือกโซนอีกครั้ง ไม่ต้องลงทะเบียนใหม่`;
			toast.error(`จัดสรรพื้นที่ไม่สำเร็จ: ${detail}`);
		}
	}
</script>

<!-- ── Step progress ──────────────────────────────────────────────────────────── -->
<div class="mb-6 space-y-3">
	<div class="sm:hidden">
		<p class="text-xs font-medium text-muted-foreground">ขั้น {step} จาก 6</p>
		<h2 class="text-lg font-semibold">{currentStep.title}</h2>
		<p class="text-sm text-muted-foreground">{currentStep.description}</p>
		<div
			class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
			role="progressbar"
			aria-valuenow={step}
			aria-valuemin={1}
			aria-valuemax={6}
			aria-label="ความคืบหน้าการลงทะเบียน"
		>
			<div
				class="h-full rounded-full bg-primary transition-all"
				style:width={`${(step / 6) * 100}%`}
			></div>
		</div>
	</div>

	<div class="hidden sm:block">
		<div class="mb-4 flex items-start">
			{#each STEPS as meta, i (meta.short)}
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
							class="h-0.5 flex-1 transition-colors {s === 6
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
		<h2 class="text-xl font-semibold">{currentStep.title}</h2>
		<p class="text-sm text-muted-foreground">{currentStep.description}</p>
	</div>
</div>

{#if zoneError}
	<Alert.Root variant="destructive" class="mb-4 border-destructive/40 bg-destructive/5">
		<CircleAlert class="size-4" />
		<Alert.Title class="font-semibold">จัดสรรพื้นที่ไม่สำเร็จ</Alert.Title>
		<Alert.Description class="space-y-3">
			<p>{zoneError}</p>
			<Button type="button" variant="outline" size="sm" onclick={() => (zoneError = null)}>
				ปิดการแจ้งเตือน
			</Button>
		</Alert.Description>
	</Alert.Root>
{/if}

{#if registrationDraftActive}
	<div class:hidden={step !== 3}>
		<RegistrationSection
			onsubmit={handleRegistrationSubmit}
			pending={isSubmittingEvacuee || pending}
			onBack={() => goToStep(2)}
			hasSymptomsSelected={selectedSymptoms.size > 0}
			initialInput={registrationDraft}
			ondraftchange={(input) => (registrationDraft = structuredClone(input))}
			bind:facePhotoUrl={registrationFacePhotoUrl}
		/>
	</div>
{/if}

{#if step === 1}
	<SearchSection onNext={() => goToStep(2)} onSelectDraft={handleSelectDraft} />
{:else if step === 2}
	<EwarSymptomSection
		bind:isHealthy
		{selectedSymptoms}
		onBack={() => goToStep(1)}
		onNext={() => goToStep(3)}
	/>
{:else if step === 4}
	<div class="space-y-6">
		<Alert.Root class="border-primary/30 bg-primary/5">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">ผู้ประสบภัยทุกคนต้องมีครัวเรือน</Alert.Title>
			<Alert.Description>
				เลือกครัวเรือนเดิม หรือสร้างครัวเรือนใหม่ หากมาเพียงคนเดียวให้สร้างครัวเรือน 1 คน
				โดยผู้ลงทะเบียนจะเป็นหัวหน้าครัวเรือน
			</Alert.Description>
		</Alert.Root>

		{#if householdDataLoading}
			<div class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
				<Loader2 class="size-4 animate-spin" />
				กำลังโหลดข้อมูลครัวเรือน...
			</div>
		{:else}
			{#if householdDataError}
				<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5">
					<CircleAlert class="size-4" />
					<Alert.Title class="font-semibold">โหลดข้อมูลครัวเรือนไม่สำเร็จ</Alert.Title>
					<Alert.Description class="space-y-3">
						<p>ยังค้นหาครัวเรือนที่มีอยู่ไม่ได้ แต่ยังสามารถสร้างครัวเรือนใหม่ได้</p>
						<Button type="button" variant="outline" size="sm" onclick={retryHouseholdData}>
							ลองใหม่
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
				pending={isSubmittingHousehold}
				bind:showNewHouseholdForm={isCreatingNewHousehold}
			/>
		{/if}

		<div
			class="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
		>
			{#if !isCreatingNewHousehold}
				<Button
					type="button"
					variant="default"
					class="h-12 w-full text-sm font-medium sm:h-10 sm:w-auto sm:px-6"
					disabled={isSubmittingHousehold || !selectedHousehold}
					onclick={() => goToStep(5)}
				>
					ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)
				</Button>
			{/if}
			<Button
				type="button"
				variant="ghost"
				onclick={() => goToStep(3)}
				class="h-12 w-full text-sm font-medium sm:h-10 sm:w-auto sm:px-6"
			>
				ย้อนกลับ
			</Button>
		</div>
	</div>
{:else if step === 5}
	<EvacueePetAssetVehicle
		household={selectedHousehold}
		pending={isSubmittingHousehold}
		onBack={() => goToStep(4)}
		onNext={handleFinalSubmit}
	/>
{:else if step === 6}
	<EvacueeSelectZone
		evacuee={newlyRegisteredEvacuee}
		pending={checkInMutation.isPending}
		onBack={() => {
			goToStep(5);
		}}
		onSubmit={handleZoneSubmit}
	/>
{/if}

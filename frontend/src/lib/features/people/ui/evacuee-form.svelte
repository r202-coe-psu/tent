<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { EvacueeInput, HouseholdInput } from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdRegisterForm from './household-register-form.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateEvacuee,
		SHELTER_CODE
	} from '../index';

	let {
		onsubmit,
		pending = false,
		step = $bindable(1)
	}: {
		onsubmit: (input: EvacueeInput, symptoms: string[]) => Promise<any> | any;
		pending?: boolean;
		step?: 1 | 2 | 3 | 4;
	} = $props();

	const selectedSymptoms = new SvelteSet<string>();
	let isHealthy = $state(false);
	let newlyRegisteredEvacuee = $state<any>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);

	let pendingEvacueeInput = $state<EvacueeInput | null>(null);
	let pendingSymptoms = $state<string[]>([]);

	let tempEvacuee = $derived.by(() => {
		if (!pendingEvacueeInput) return null;
		return {
			_id: 'temp-new-evacuee',
			...pendingEvacueeInput,
			current_stay: {
				status: 'checked_in',
				zone: null
			}
		} as any;
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

	const createHouseholdMutation = useCreateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	function handleRegistrationSubmit(input: EvacueeInput) {
		pendingEvacueeInput = input;
		pendingSymptoms = Array.from(selectedSymptoms);
		selectedSymptoms.clear();
		isHealthy = false;
		step = 4;
	}

	async function handleHouseholdSelect(household: any) {
		if (isSubmittingHousehold) return;
		isSubmittingHousehold = true;

		try {
			const ctx = {
				shelterCode: shelterStore.selectedShelterCode ?? SHELTER_CODE,
				createdBy: authStore.user?.name ?? 'unknown'
			};

			let registeredEvacuee = newlyRegisteredEvacuee;
			if (pendingEvacueeInput) {
				registeredEvacuee = await onsubmit(pendingEvacueeInput, pendingSymptoms);
				newlyRegisteredEvacuee = registeredEvacuee;
				pendingEvacueeInput = null;
				pendingSymptoms = [];
			}

			if (!registeredEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัยที่กำลังลงทะเบียน');
			}

			// Update the newly created evacuee's household_id to the selected household's ID
			await updateEvacueeMutation.mutateAsync({
				...registeredEvacuee,
				household_id: household._id
			});
			toast.success(`เข้าร่วมครัวเรือน "${household.label}" สำเร็จ`);

			// Go back to step 1
			step = 1;
			newlyRegisteredEvacuee = null;
		} catch (err: any) {
			toast.error(`เกิดข้อผิดพลาด: ${err.message || err}`);
		} finally {
			isSubmittingHousehold = false;
		}
	}

	async function handleHouseholdRegisterSubmit(addressInput: Partial<HouseholdInput>) {
		if (isSubmittingHousehold) return;
		isSubmittingHousehold = true;

		try {
			const ctx = {
				shelterCode: shelterStore.selectedShelterCode ?? SHELTER_CODE,
				createdBy: authStore.user?.name ?? 'unknown'
			};

			let registeredEvacuee = newlyRegisteredEvacuee;
			if (pendingEvacueeInput) {
				registeredEvacuee = await onsubmit(pendingEvacueeInput, pendingSymptoms);
				newlyRegisteredEvacuee = registeredEvacuee;
				pendingEvacueeInput = null;
				pendingSymptoms = [];
			}

			if (!registeredEvacuee) {
				throw new Error('ไม่พบข้อมูลผู้ประสบภัยที่กำลังลงทะเบียน');
			}

			// Create a household label based on the evacuee's name
			const householdLabel = `ครอบครัว${registeredEvacuee.first_name} ${registeredEvacuee.last_name}`;

			// Construct HouseholdInput
			const householdInput: HouseholdInput = {
				label: householdLabel,
				head_evacuee_id: registeredEvacuee._id,
				municipality_zone: null,
				community: null,
				pets: [],
				notes: '',
				address_no: addressInput.address_no || null,
				village_no: addressInput.village_no || null,
				subdistrict: addressInput.subdistrict || null,
				district: addressInput.district || null,
				province: addressInput.province || null,
				postal_code: addressInput.postal_code || null
			};

			// Create household
			const res = await createHouseholdMutation.mutateAsync({ input: householdInput, ctx });
			const householdId = res._id;
			toast.success(`สร้างครัวเรือน "${res.label}" สำเร็จ`);

			// Update the evacuee to link to the new household
			await updateEvacueeMutation.mutateAsync({
				...registeredEvacuee,
				household_id: householdId
			});

			// Go back to step 1
			step = 1;
			newlyRegisteredEvacuee = null;
		} catch (err: any) {
			toast.error(`เกิดข้อผิดพลาด: ${err.message || err}`);
		} finally {
			isSubmittingHousehold = false;
		}
	}

	function handleHouseholdCancel() {
		step = 1;
		newlyRegisteredEvacuee = null;
		pendingEvacueeInput = null;
		pendingSymptoms = [];
	}
</script>

<!-- ── Step indicator ─────────────────────────────────────────────────────────── -->
<div class="mb-6 flex items-center gap-3">
	{#each [1, 2, 3, 4] as s (s)}
		<div class="flex items-center gap-2">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
				s
					? 'bg-primary text-primary-foreground'
					: step > s
						? 'bg-green-600 text-white'
						: 'bg-muted text-muted-foreground'}"
			>
				{step > s ? '✓' : s}
			</div>
			<span class="text-sm font-medium {step === s ? 'text-foreground' : 'text-muted-foreground'}">
				{s === 1 ? 'ตรวจสอบประวัติ' : s === 2 ? 'ประเมินอาการ (EWAR)' : s === 3 ? 'ข้อมูลผู้ประสบภัย' : 'ข้อมูลครัวเรือน'}
			</span>
		</div>
		{#if s < 4}
			<div class="h-px flex-1 bg-border hidden sm:block"></div>
		{/if}
	{/each}
</div>

{#if step === 1}
	<SearchSection onNext={() => (step = 2)} />
{:else if step === 2}
	<EwarSymptomSection
		bind:isHealthy
		{selectedSymptoms}
		onNext={() => (step = 3)}
	/>
{:else if step === 3}
	<RegistrationSection
		onsubmit={handleRegistrationSubmit}
		pending={isSubmittingEvacuee || pending}
		onBack={() => (step = 2)}
		
	/>
{:else if step === 4}
	<div class="space-y-6">
		<HouseholdRegisterForm
			allEvacuees={combinedEvacuees}
			households={householdsQuery.data ?? []}
			onsubmit={handleHouseholdRegisterSubmit}
			onselect={handleHouseholdSelect}
			pending={isSubmittingHousehold}
		/>
		<div class="flex justify-between items-center border-t border-border pt-6">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					step = 3;
				}}
				class="h-10 gap-1 px-6 py-2 text-sm font-medium"
			>
				ย้อนกลับ
			</Button>
			<Button
				type="button"
				variant="ghost"
				onclick={handleHouseholdCancel}
				class="h-10 text-sm font-medium text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
			>
				ยกเลิกการลงทะเบียน
			</Button>
		</div>
	</div>
{/if}

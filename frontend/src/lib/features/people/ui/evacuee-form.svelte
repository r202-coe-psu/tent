<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { EvacueeInput, HouseholdInput } from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';
	import HouseholdForm from './household-form.svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
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

	let selectedSymptoms = $state(new SvelteSet<string>());
	let isHealthy = $state(false);
	let newlyRegisteredEvacuee = $state<any>(null);
	let isSubmittingEvacuee = $state(false);
	let isSubmittingHousehold = $state(false);

	// Fetch data for HouseholdForm
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const shelterQuery = useShelter(() => SHELTER_CODE);
	const zones = $derived(shelterQuery.data?.zones ?? []);

	const createHouseholdMutation = useCreateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	async function handleRegistrationSubmit(input: EvacueeInput) {
		isSubmittingEvacuee = true;
		try {
			const result = await onsubmit(input, Array.from(selectedSymptoms));
			newlyRegisteredEvacuee = result;
			selectedSymptoms.clear();
			isHealthy = false;
			step = 4;
		} catch (err) {
			// Error is already toasted in page, or we can handle it if needed
		} finally {
			isSubmittingEvacuee = false;
		}
	}

	async function handleHouseholdSubmit(
		input: HouseholdInput,
		selectedMemberIds: string[],
		emergencyContactPhone?: string
	) {
		if (isSubmittingHousehold) return;
		isSubmittingHousehold = true;

		try {
			const ctx = {
				shelterCode: shelterStore.selectedShelterCode ?? SHELTER_CODE,
				createdBy: authStore.user?.name ?? 'unknown'
			};

			// Create household
			const res = await createHouseholdMutation.mutateAsync({ input, ctx });
			const householdId = res._id;
			toast.success(`สร้างครัวเรือน "${res.label}" สำเร็จ`);

			// Sync membership
			const allEvacuees = evacueesQuery.data ?? [];
			const currentMembers = allEvacuees.filter((ev) => ev.household_id === householdId);
			const currentMemberIds = currentMembers.map((ev) => ev._id);

			const toAdd = selectedMemberIds.filter((id) => !currentMemberIds.includes(id));
			const toRemove = currentMemberIds.filter((id) => !selectedMemberIds.includes(id));

			const getUpdatedEmergencyContact = (evac: any, phone: string | undefined) => {
				if (phone === undefined) return evac.emergency_contact;
				const trimmed = phone.trim();
				if (!trimmed) return undefined;
				return {
					name: evac.emergency_contact?.name || 'ผู้ติดต่อฉุกเฉิน',
					relation: evac.emergency_contact?.relation || 'ติดต่อฉุกเฉิน',
					phone: trimmed
				};
			};

			// Add members
			for (const evacId of toAdd) {
				const evac = allEvacuees.find((ev) => ev._id === evacId);
				if (evac) {
					const isHead = input.head_evacuee_id === evacId;
					const updatedEvac: any = {
						...evac,
						household_id: householdId
					};
					if (isHead && emergencyContactPhone !== undefined) {
						const updatedContact = getUpdatedEmergencyContact(evac, emergencyContactPhone);
						if (updatedContact) {
							updatedEvac.emergency_contact = updatedContact;
						} else {
							delete updatedEvac.emergency_contact;
						}
					}
					await updateEvacueeMutation.mutateAsync(updatedEvac);
				}
			}

			// Remove members
			for (const evacId of toRemove) {
				const evac = allEvacuees.find((ev) => ev._id === evacId);
				if (evac) {
					await updateEvacueeMutation.mutateAsync({
						...evac,
						household_id: null
					});
				}
			}

			// If the head evacuee was already a member (not in toAdd), update emergency contact if changed
			if (input.head_evacuee_id && !toAdd.includes(input.head_evacuee_id)) {
				const headEvac = allEvacuees.find((ev) => ev._id === input.head_evacuee_id);
				if (headEvac && emergencyContactPhone !== undefined) {
					const currentPhone = headEvac.emergency_contact?.phone ?? '';
					const trimmedPhone = emergencyContactPhone.trim();
					if (currentPhone !== trimmedPhone) {
						const updatedEvac = {
							...headEvac
						};
						const updatedContact = getUpdatedEmergencyContact(headEvac, emergencyContactPhone);
						if (updatedContact) {
							updatedEvac.emergency_contact = updatedContact;
						} else {
							delete updatedEvac.emergency_contact;
						}
						await updateEvacueeMutation.mutateAsync(updatedEvac);
					}
				}
			}

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
	<HouseholdForm
		onsubmit={handleHouseholdSubmit}
		oncancel={handleHouseholdCancel}
		pending={isSubmittingHousehold}
		allEvacuees={evacueesQuery.data ?? []}
		zones={zones}
		households={householdsQuery.data ?? []}
		initialMemberIds={newlyRegisteredEvacuee ? [newlyRegisteredEvacuee._id] : []}
	/>
{/if}

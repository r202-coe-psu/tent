<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Home from '@lucide/svelte/icons/home';
	import HouseholdForm from './household-form.svelte';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateHousehold,
		useUpdateEvacuee,
		SHELTER_CODE,
		type HouseholdInput,
		type Evacuee
	} from '../index';
	import { authStore } from '$lib/stores/auth.svelte';

	let {
		id = '',
		isEdit = false
	}: {
		id?: string;
		isEdit?: boolean;
	} = $props();

	const isEditMode = $derived(isEdit);

	// Fetch data
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	// Find editing household if relevant
	const editingHousehold = $derived(
		isEditMode && id && householdsQuery.data
			? householdsQuery.data.find((h) => h._id === id) || null
			: null
	);

	// Mutations
	const createHouseholdMutation = useCreateHousehold();
	const updateHouseholdMutation = useUpdateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	let isSubmitting = $state(false);

	// Determine back URL based on search params or default to evacuee-management
	const backUrl = $derived.by(() => {
		const redirectParam = $page.url.searchParams.get('redirect');
		if (redirectParam === 'onsite') {
			return resolve('/onsite');
		}
		return resolve('/back-office/evacuee-management?tab=household');
	});

	async function handleFormSubmit(
		input: HouseholdInput,
		selectedMemberIds: string[],
		emergencyContactPhone?: string
	) {
		if (isSubmitting) return;
		isSubmitting = true;

		try {
			const ctx = {
				shelterCode: SHELTER_CODE,
				createdBy: authStore.user?.name ?? 'unknown'
			};

			let householdId = '';
			if (isEditMode && editingHousehold) {
				const updated = {
					...editingHousehold,
					label: input.label,
					head_evacuee_id: input.head_evacuee_id ?? null,
					municipality_zone: input.municipality_zone ?? null,
					community: input.community ?? null,
					pets: (input.pets ?? []).map((p) => ({
						species: p.species,
						count: Number(p.count),
						notes: p.notes ?? undefined,
						has_cage: p.has_cage ?? undefined,
						image_url: p.image_url ?? null
					})),
					assets: input.assets
						? { description: input.assets.description, image_url: input.assets.image_url ?? null }
						: null,
					vehicles: (input.vehicles ?? []).map((v) => ({
						type: v.type,
						license_plate: v.license_plate ?? null
					})),
					notes: input.notes ?? undefined,
					address_no: input.address_no || null,
					village_no: input.village_no || null,
					subdistrict: input.subdistrict || null,
					district: input.district || null,
					province: input.province || null,
					postal_code: input.postal_code || null
				};
				await updateHouseholdMutation.mutateAsync(updated);
				householdId = editingHousehold._id;
				toast.success(`แก้ไขข้อมูลครัวเรือน "${updated.label}" สำเร็จ`);
			} else {
				const res = await createHouseholdMutation.mutateAsync({ input, ctx });
				householdId = res._id;
				toast.success(`สร้างครัวเรือน "${res.label}" สำเร็จ`);
			}

			// Sync membership
			const allEvacuees = evacueesQuery.data ?? [];
			const currentMembers = allEvacuees.filter((ev) => ev.household_id === householdId);
			const currentMemberIds = currentMembers.map((ev) => ev._id);

			const toAdd = selectedMemberIds.filter((id) => !currentMemberIds.includes(id));
			const toRemove = currentMemberIds.filter((id) => !selectedMemberIds.includes(id));

			// Helper to get updated emergency contact
			const getUpdatedEmergencyContact = (evac: Evacuee, phone: string | undefined) => {
				if (phone === undefined) return evac.emergency_contact;
				const trimmed = phone.trim();
				if (!trimmed) return undefined; // clear it
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

			// If the head evacuee was already a member (not in toAdd), update their contact phone if changed
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

			// Navigate back
			await goto(backUrl);
		} catch (err: any) {
			toast.error(`เกิดข้อผิดพลาด: ${err.message || err}`);
		} finally {
			isSubmitting = false;
		}
	}

	function handleCancel() {
		goto(backUrl);
	}
</script>

<svelte:head>
	<title>{isEditMode ? 'แก้ไขข้อมูลครัวเรือน' : 'เพิ่มครัวเรือนใหม่'} · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-6">
	<div>
		<button
			type="button"
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
			onclick={handleCancel}
		>
			<ArrowLeft class="size-4" />
			<span>กลับไปหน้ารายชื่อหลัก</span>
		</button>
		<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
			{isEditMode
				? 'แก้ไขข้อมูลครัวเรือน (Edit Household)'
				: 'เพิ่มครัวเรือนใหม่ (Create Household)'}
		</h2>
	</div>

	{#if evacueesQuery.isLoading || householdsQuery.isLoading}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-6 py-12 shadow-xs"
		>
			<div
				class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
			></div>
			<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูลระบบ...</p>
		</div>
	{:else if isEditMode && !editingHousehold}
		<div class="rounded-2xl border border-border bg-card p-6 py-12 text-center shadow-xs">
			<p class="text-sm font-semibold text-destructive">ไม่พบข้อมูลครัวเรือนที่ต้องการแก้ไข</p>
			<Button variant="outline" class="mt-4" onclick={handleCancel}>กลับหน้าหลัก</Button>
		</div>
	{:else}
		<HouseholdForm
			onsubmit={handleFormSubmit}
			oncancel={handleCancel}
			pending={isSubmitting}
			initialData={editingHousehold}
			allEvacuees={evacueesQuery.data ?? []}
			households={householdsQuery.data ?? []}
		/>
	{/if}
</div>

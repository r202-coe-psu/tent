<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { householdInputSchema } from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import HouseholdFormHeadSection from './household-form-head-section.svelte';
	import HouseholdFormMembersSection from './household-form-members-section.svelte';
	import HouseholdFormLocationSection from './household-form-location-section.svelte';
	import HouseholdFormPetsSection from './household-form-pets-section.svelte';

	let {
		onsubmit,
		oncancel,
		pending = false,
		initialData = null,
		allEvacuees = [],
		households = [],
		initialMemberIds = []
	}: {
		onsubmit: (
			input: HouseholdInput,
			selectedMemberIds: string[],
			emergencyContactPhone?: string
		) => void;
		oncancel: () => void;
		pending?: boolean;
		initialData?: Household | null;
		allEvacuees?: Evacuee[];
		households?: Household[];
		initialMemberIds?: string[];
	} = $props();

	// --- Master data queries ---
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const municipalityZoneItems = $derived(
		(municipalityZoneQuery.data?.items ?? []).map((z) => ({ value: z.code, label: z.label }))
	);
	const communityItems = $derived(
		(communityQuery.data?.items ?? []).map((c) => ({ value: c.code, label: c.label }))
	);

	// --- Superform ---
	const form = superForm(defaults(zod4(householdInputSchema)), {
		SPA: true,
		validators: zod4(householdInputSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			if ($formData.head_evacuee_id && !emergencyContactPhone.trim()) return;
			onsubmit(form.data, selectedMemberIds, emergencyContactPhone.trim());
		}
	});

	const { form: formData, submitting } = form;

	// Combobox bridge state
	let mzVal = $state('');
	let commVal = $state('');

	$effect(() => { $formData.municipality_zone = mzVal || null; });
	$effect(() => { $formData.community = commVal || null; });

	// Member / pet state
	let dogCount = $state(0);
	let catCount = $state(0);
	let birdCount = $state(0);
	let otherCount = $state(0);
	let selectedMemberIds = $state<string[]>([]);
	let memberSearchValue = $state('');
	let headComboValue = $state('');
	let noHead = $state(false);
	let emergencyContactPhone = $state('');
	let membersInitialized = $state(false);

	// Pre-fill from initialData — avoids reading allEvacuees to prevent live-sync re-runs
	$effect(() => {
		if (initialData) {
			$formData.label = initialData.label;
			$formData.head_evacuee_id = initialData.head_evacuee_id;
			headComboValue = initialData.head_evacuee_id ?? '';
			noHead = initialData.head_evacuee_id === null;
			$formData.notes = initialData.notes ?? '';
			$formData.address_no = initialData.address_no ?? '';
			$formData.village_no = initialData.village_no ?? '';
			$formData.subdistrict = initialData.subdistrict ?? '';
			$formData.district = initialData.district ?? '';
			$formData.province = initialData.province ?? '';
			$formData.postal_code = initialData.postal_code ?? '';
			mzVal = initialData.municipality_zone ?? '';
			commVal = initialData.community ?? '';
			dogCount = initialData.pets.find((p) => p.species === 'dog')?.count ?? 0;
			catCount = initialData.pets.find((p) => p.species === 'cat')?.count ?? 0;
			birdCount = initialData.pets.find((p) => p.species === 'bird')?.count ?? 0;
			otherCount = initialData.pets.find((p) => p.species === 'other')?.count ?? 0;
			membersInitialized = false;
		} else {
			$formData.label = '';
			$formData.head_evacuee_id = null;
			headComboValue = '';
			noHead = false;
			$formData.notes = '';
			$formData.address_no = '';
			$formData.village_no = '';
			$formData.subdistrict = '';
			$formData.district = '';
			$formData.province = '';
			$formData.postal_code = '';
			mzVal = '';
			commVal = '';
			dogCount = 0;
			catCount = 0;
			birdCount = 0;
			otherCount = 0;
			selectedMemberIds = [...initialMemberIds];
			membersInitialized = true;
		}
	});

	// Initialize selectedMemberIds once after allEvacuees loads
	$effect(() => {
		if (membersInitialized || !initialData) return;
		if (allEvacuees.length === 0) return;
		selectedMemberIds = allEvacuees
			.filter((e) => e.household_id === initialData._id)
			.map((e) => e._id);
		membersInitialized = true;
	});

	// Sync pets array to form
	$effect(() => {
		const petGroups = [];
		if (dogCount > 0) petGroups.push({ species: 'dog' as const, count: dogCount });
		if (catCount > 0) petGroups.push({ species: 'cat' as const, count: catCount });
		if (birdCount > 0) petGroups.push({ species: 'bird' as const, count: birdCount });
		if (otherCount > 0) petGroups.push({ species: 'other' as const, count: otherCount });
		$formData.pets = petGroups;
	});

	// Track head changes: remove old head from members, clear phone, add new head
	let prevHeadId = $state<string | null>(null);
	$effect(() => {
		const newHead = $formData.head_evacuee_id;
		if (newHead !== prevHeadId) {
			if (prevHeadId !== null) {
				selectedMemberIds = selectedMemberIds.filter((id) => id !== prevHeadId);
			}
			emergencyContactPhone = '';
			prevHeadId = newHead;
		}
		if (newHead && !selectedMemberIds.includes(newHead)) {
			selectedMemberIds = [...selectedMemberIds, newHead];
		}
	});

	// Sync headComboValue → formData
	$effect(() => { $formData.head_evacuee_id = headComboValue || null; });

	// Add member when combobox selects
	$effect(() => {
		if (memberSearchValue) {
			if (!selectedMemberIds.includes(memberSearchValue))
				selectedMemberIds = [...selectedMemberIds, memberSearchValue];
			memberSearchValue = '';
		}
	});

	const memberItems = $derived(
		allEvacuees
			.filter((e) => !e.privacy?.search_excluded)
			.map((e) => ({
				value: e._id,
				label: `${e.first_name} ${e.last_name}`,
				evacuee: e,
				hasOther: !!(e.household_id && initialData && e.household_id !== initialData._id),
				otherLabel: households.find((h) => h._id === e.household_id)?.label ?? 'ครัวเรือนอื่น'
			}))
	);

	const headItems = $derived([
		...allEvacuees
			.filter((e) => !e.privacy?.search_excluded)
			.map((e) => ({
				value: e._id,
				label: `${e.first_name} ${e.last_name}`,
				evacuee: e as Evacuee | null
			}))
	]);

	function removeMember(id: string) {
		selectedMemberIds = selectedMemberIds.filter((mId) => mId !== id);
		if ($formData.head_evacuee_id === id) $formData.head_evacuee_id = null;
	}
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<HouseholdFormHeadSection
			{form}
			{headItems}
			bind:headComboValue
			bind:noHead
			{allEvacuees}
			bind:emergencyContactPhone
		/>

		<HouseholdFormMembersSection
			{memberItems}
			bind:memberSearchValue
			{selectedMemberIds}
			{allEvacuees}
			{initialData}
			{households}
			headEvacueeId={$formData.head_evacuee_id}
			onRemove={removeMember}
		/>

		<HouseholdFormLocationSection
			{form}
			bind:mzVal
			bind:commVal
			{municipalityZoneItems}
			{communityItems}
			mzPending={municipalityZoneQuery.isPending}
			commPending={communityQuery.isPending}
		/>

		<HouseholdFormPetsSection
			{form}
			bind:dogCount
			bind:catCount
			bind:birdCount
			bind:otherCount
		/>

		<!-- บันทึกเพิ่มเติม -->
		<Form.Field {form} name="notes">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>บันทึกเพิ่มเติม</Form.Label>
					<textarea
						{...props}
						bind:value={$formData.notes}
						placeholder="ข้อมูลเพิ่มเติม เช่น เบอร์ติดต่อสำรอง, ปัญหาสุขภาพของสัตว์เลี้ยง..."
						class="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
					></textarea>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Actions -->
		<div class="flex justify-end gap-2 pt-2">
			<Button type="button" variant="outline" onclick={oncancel}>ยกเลิก</Button>
			<Form.Button disabled={$submitting || pending}>
				{pending ? 'กำลังบันทึก...' : 'บันทึก'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>

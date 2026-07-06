<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { toast } from 'svelte-sonner';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { householdInputSchema } from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import type {
		Household,
		Evacuee,
		HouseholdInput,
		HouseholdStatus,
		PetGroup
	} from '../domain/people';

	// Read-only presentation of the household lifecycle status.
	// Status is not free-editable here — it follows check-in/check-out flows.
	const STATUS_DISPLAY: Record<HouseholdStatus, { label: string; variant: BadgeVariant }> = {
		pre_registered: { label: 'ลงทะเบียนล่วงหน้า', variant: 'secondary' },
		arriving: { label: 'กำลังเดินทางมา', variant: 'outline' },
		checked_in: { label: 'เช็คอินแล้ว', variant: 'default' },
		checked_out: { label: 'เช็คเอาท์แล้ว', variant: 'secondary' },
		cancelled: { label: 'ยกเลิก', variant: 'destructive' }
	};
	import HouseholdFormHeadSection from './household-form-head-section.svelte';
	import HouseholdFormMembersSection from './household-form-members-section.svelte';
	import HouseholdFormLocationSection from './household-form-location-section.svelte';
	import HouseholdFormPetsSection from './household-form-pets-section.svelte';
	import HouseholdFormAssetsSection from './household-form-assets-section.svelte';

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

	$effect(() => {
		$formData.municipality_zone = mzVal || null;
	});
	$effect(() => {
		$formData.community = commVal || null;
	});

	// Member / pet state
	let petsList = $state<PetGroup[]>([]);
	let selectedMemberIds = $state<string[]>([]);
	let memberSearchValue = $state('');
	let headComboValue = $state('');
	let noHead = $state(false);
	let emergencyContactPhone = $state('');
	let membersInitialized = $state(false);

	// Sync head contact phone on edit/select
	$effect(() => {
		if ($formData.head_evacuee_id && allEvacuees.length > 0 && !emergencyContactPhone) {
			const head = allEvacuees.find((e) => e._id === $formData.head_evacuee_id);
			if (head?.emergency_contact?.phone) {
				emergencyContactPhone = head.emergency_contact.phone;
			}
		}
	});

	// Vehicle & Assets state — a household may bring several vehicles (schema vehicles[]).
	// `id` is a client-only key for the {#each}; stripped when synced to $formData.
	type VehicleRow = { id: number; type: 'car' | 'motorcycle' | 'other'; license_plate: string };
	let vehicleRows = $state<VehicleRow[]>([]);
	let nextVehicleId = 0;
	let assetDescription = $state('');

	function addVehicle() {
		vehicleRows = [...vehicleRows, { id: nextVehicleId++, type: 'car', license_plate: '' }];
	}
	function removeVehicle(id: number) {
		vehicleRows = vehicleRows.filter((v) => v.id !== id);
	}

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
			petsList = initialData.pets ? JSON.parse(JSON.stringify(initialData.pets)) : [];
			vehicleRows = (initialData.vehicles ?? []).map((v) => ({
				id: nextVehicleId++,
				type: v.type,
				license_plate: v.license_plate ?? ''
			}));
			assetDescription = initialData.assets?.description ?? '';
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
			petsList = [];
			vehicleRows = [];
			assetDescription = '';
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

	// Sync states to form
	$effect(() => {
		$formData.pets = petsList.map((p) => ({
			species: p.species,
			count: Number(p.count),
			notes: p.notes?.trim() || undefined,
			has_cage: !!p.has_cage,
			image_url: p.image_url || null
		}));
	});

	$effect(() => {
		$formData.vehicles = vehicleRows.map((v) => ({
			type: v.type,
			license_plate: v.license_plate.trim() || null
		}));
	});

	$effect(() => {
		$formData.assets = assetDescription.trim()
			? { description: assetDescription.trim(), image_url: null }
			: null;
	});

	// Track head changes: remove old head from members, clear phone, add new head, validate duplicate active household
	let prevHeadId = $state<string | null>(null);
	$effect(() => {
		const newHead = $formData.head_evacuee_id;
		if (newHead && newHead !== prevHeadId) {
			const evac = allEvacuees.find((e) => e._id === newHead);
			if (evac && evac.household_id && (!initialData || evac.household_id !== initialData._id)) {
				const hh = households.find((h) => h._id === evac.household_id);
				const hhStatus = hh?.status ?? 'checked_in';
				if (hhStatus !== 'cancelled' && hhStatus !== 'checked_out') {
					toast.error(
						`ไม่สามารถกำหนดเป็นหัวหน้าได้ เนื่องจาก ${evac.first_name} ${evac.last_name} สังกัดครัวเรือน "${hh?.label ?? 'อื่น'}" ที่ยังมีสถานะใช้งานอยู่`
					);
					headComboValue = prevHeadId ?? '';
					$formData.head_evacuee_id = prevHeadId;
					return;
				}
			}
		}
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
	$effect(() => {
		$formData.head_evacuee_id = headComboValue || null;
	});

	// Add member when combobox selects, validate duplicate active household
	$effect(() => {
		if (memberSearchValue) {
			if (!selectedMemberIds.includes(memberSearchValue)) {
				const evac = allEvacuees.find((e) => e._id === memberSearchValue);
				if (evac && evac.household_id && (!initialData || evac.household_id !== initialData._id)) {
					const hh = households.find((h) => h._id === evac.household_id);
					const hhStatus = hh?.status ?? 'checked_in';
					if (hhStatus !== 'cancelled' && hhStatus !== 'checked_out') {
						toast.error(
							`ไม่สามารถเพิ่มสมาชิกได้ เนื่องจาก ${evac.first_name} ${evac.last_name} สังกัดครัวเรือน "${hh?.label ?? 'อื่น'}" ที่ยังมีสถานะใช้งานอยู่`
						);
						memberSearchValue = '';
						return;
					}
				}
				selectedMemberIds = [...selectedMemberIds, memberSearchValue];
			}
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

<form method="POST" use:form.enhance class="space-y-6">
	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
		<!-- Left Column: General Info, Members, and Pets -->
		<div class="space-y-6">
			<!-- General Info & Head -->
			<div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">
						ข้อมูลครัวเรือนเบื้องต้น
					</h3>
					{#if initialData}
						<div class="flex items-center gap-1.5">
							<span class="text-xs text-muted-foreground">สถานะ</span>
							<Badge variant={STATUS_DISPLAY[initialData.status].variant}>
								{STATUS_DISPLAY[initialData.status].label}
							</Badge>
						</div>
					{/if}
				</div>
				<HouseholdFormHeadSection
					{form}
					{headItems}
					bind:headComboValue
					bind:noHead
					{allEvacuees}
					bind:emergencyContactPhone
				/>
			</div>

			<!-- Members Section -->
			<div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
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
			</div>

			<!-- Pets Section -->
			<HouseholdFormPetsSection {form} bind:petsList />
		</div>

		<!-- Right Column: Location, Assets, and Notes -->
		<div class="space-y-6">
			<!-- Location Section -->
			<div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
				<HouseholdFormLocationSection
					{form}
					bind:mzVal
					bind:commVal
					{municipalityZoneItems}
					{communityItems}
					mzPending={municipalityZoneQuery.isPending}
					commPending={communityQuery.isPending}
				/>
			</div>

			<!-- Assets Section -->
			<div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
				<HouseholdFormAssetsSection
					{vehicleRows}
					onAddVehicle={addVehicle}
					onRemoveVehicle={removeVehicle}
					bind:assetDescription
				/>
			</div>

			<!-- Notes Section -->
			<div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
				<Form.Field {form} name="notes">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-base font-bold text-slate-800 dark:text-slate-200"
								>บันทึกเพิ่มเติม</Form.Label
							>
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
			</div>
		</div>
	</div>

	<!-- Actions -->
	<div class="flex justify-end gap-2 border-t border-border pt-4">
		<Button type="button" variant="outline" onclick={oncancel}>ยกเลิก</Button>
		<Form.Button disabled={$submitting || pending}>
			{pending ? 'กำลังบันทึก...' : 'บันทึก'}
		</Form.Button>
	</div>
</form>

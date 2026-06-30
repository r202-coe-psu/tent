<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import X from '@lucide/svelte/icons/x';
	import UserRound from '@lucide/svelte/icons/user-round';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { maskNationalId } from '../domain/people';
	import { householdInputSchema } from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';

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

	// --- Master data queries (independent; no parent_code filtering on community) ---
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

	// Local combobox bridge state (Combobox binds string, formData uses string | null)
	let mzVal = $state('');
	let commVal = $state('');

	$effect(() => {
		$formData.municipality_zone = mzVal || null;
	});
	$effect(() => {
		$formData.community = commVal || null;
	});

	// --- Member / pet state ---
	let dogCount = $state(0);
	let catCount = $state(0);
	let birdCount = $state(0);
	let otherCount = $state(0);
	let selectedMemberIds = $state<string[]>([]);
	let memberSearchValue = $state('');
	let headComboValue = $state('');
	let emergencyContactPhone = $state('');
	let membersInitialized = $state(false);

	// Pre-fill form fields from initialData — does NOT read allEvacuees to avoid re-running on live-sync updates
	$effect(() => {
		if (initialData) {
			$formData.label = initialData.label;
			$formData.head_evacuee_id = initialData.head_evacuee_id;
			headComboValue = initialData.head_evacuee_id ?? '';
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

	// Initialize selectedMemberIds once from allEvacuees — re-runs only until allEvacuees loads
	$effect(() => {
		if (membersInitialized || !initialData) return;
		if (allEvacuees.length === 0) return;
		selectedMemberIds = allEvacuees
			.filter((e) => e.household_id === initialData._id)
			.map((e) => e._id);
		membersInitialized = true;
	});

	// Sync pets array
	$effect(() => {
		const petGroups = [];
		if (dogCount > 0) petGroups.push({ species: 'dog' as const, count: dogCount });
		if (catCount > 0) petGroups.push({ species: 'cat' as const, count: catCount });
		if (birdCount > 0) petGroups.push({ species: 'bird' as const, count: birdCount });
		if (otherCount > 0) petGroups.push({ species: 'other' as const, count: otherCount });
		$formData.pets = petGroups;
	});

	// Track head changes: remove old head from members, add new head
	let prevHeadId = $state<string | null>(null);
	$effect(() => {
		const newHead = $formData.head_evacuee_id;
		if (newHead !== prevHeadId) {
			if (prevHeadId !== null) {
				selectedMemberIds = selectedMemberIds.filter((id) => id !== prevHeadId);
			}
			prevHeadId = newHead;
		}
		if (newHead && !selectedMemberIds.includes(newHead)) {
			selectedMemberIds = [...selectedMemberIds, newHead];
		}
	});

	const memberItems = $derived(
		allEvacuees
			.filter((e) => !e.privacy?.search_excluded)
			.map((e) => ({
				value: e._id,
				label: [e.first_name, e.last_name, e.nickname, e.phone, e.person_id?.number]
					.filter(Boolean)
					.join(' '),
				evacuee: e,
				hasOther: !!(e.household_id && initialData && e.household_id !== initialData._id),
				otherLabel: households.find((h) => h._id === e.household_id)?.label ?? 'ครัวเรือนอื่น'
			}))
	);

	$effect(() => {
		if (memberSearchValue) {
			if (!selectedMemberIds.includes(memberSearchValue))
				selectedMemberIds = [...selectedMemberIds, memberSearchValue];
			memberSearchValue = '';
		}
	});

	const headItems = $derived([
		{ value: '', label: 'ไม่มีหัวหน้าครัวเรือน', evacuee: null as Evacuee | null },
		...allEvacuees
			.filter((e) => !e.privacy?.search_excluded)
			.map((e) => ({
				value: e._id,
				label: [e.first_name, e.last_name, e.nickname, e.phone, e.person_id?.number]
					.filter(Boolean)
					.join(' '),
				evacuee: e as Evacuee | null
			}))
	]);

	$effect(() => {
		$formData.head_evacuee_id = headComboValue || null;
	});

	function removeMember(id: string) {
		selectedMemberIds = selectedMemberIds.filter((mId) => mId !== id);
		if ($formData.head_evacuee_id === id) $formData.head_evacuee_id = null;
	}
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<!-- ─────────────────────── ชื่อครัวเรือน ─────────────────────── -->
		<Form.Field {form} name="label">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชื่อเรียกครัวเรือน <span class="text-destructive">*</span></Form.Label>
					<Input
						{...props}
						bind:value={$formData.label}
						placeholder="เช่น บ้านสมชาย, ครอบครัวใจดี"
						required
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- ─────────────────────── หัวหน้าครัวเรือน ─────────────────────── -->
		<Form.Field {form} name="head_evacuee_id">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="flex items-center gap-1.5">
						<UserRound class="size-3.5 text-muted-foreground" />
						หัวหน้าครัวเรือน
					</Form.Label>
					<Combobox
						items={headItems}
						bind:value={headComboValue}
						placeholder="พิมพ์ชื่อ, เบอร์ หรือเลขบัตรเพื่อค้นหา..."
						searchPlaceholder="ค้นหาผู้ประสบภัย..."
						emptyText="ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา"
						controlProps={props}
						class="h-9 w-full"
					>
						{#snippet children({ item })}
							{#if item.evacuee}
								<span class="font-medium">{item.evacuee.first_name} {item.evacuee.last_name}</span>
								{#if item.evacuee.person_id?.number}
									<span class="text-xs text-muted-foreground">
										· {maskNationalId(item.evacuee.person_id.number)}
									</span>
								{/if}
							{:else}
								{item.label}
							{/if}
						{/snippet}
					</Combobox>
				{/snippet}
			</Form.Control>
			<Form.Description>หัวหน้าจะถูกเพิ่มเข้าสมาชิกโดยอัตโนมัติ</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Emergency contact of head -->
		{#if $formData.head_evacuee_id}
			{@const headEvac = allEvacuees.find((e) => e._id === $formData.head_evacuee_id)}
			{#if headEvac}
				<div class="space-y-1.5 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3">
					<Label
						for="emergency-phone"
						class="text-xs font-semibold tracking-wide text-primary uppercase"
					>
						เบอร์ติดต่อฉุกเฉินของหัวหน้าครัวเรือน <span class="text-destructive">*</span>
					</Label>
					<Input
						id="emergency-phone"
						type="tel"
						inputmode="numeric"
						placeholder="ระบุเบอร์โทรศัพท์ (ตัวเลขเท่านั้น)"
						value={emergencyContactPhone}
						oninput={(e) => {
							emergencyContactPhone = (e.currentTarget as HTMLInputElement).value.replace(
								/\D/g,
								''
							);
						}}
						class="bg-background"
						required
					/>
					<p class="text-[11px] text-muted-foreground">
						จะบันทึกใน emergency contact ของ {headEvac.first_name}
						{headEvac.last_name}
					</p>
				</div>
			{/if}
		{/if}

		<!-- ─────────────────────── สมาชิก ─────────────────────── -->
		<div class="space-y-2">
			<Label class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				สมาชิกในครัวเรือน
			</Label>

			<Combobox
				items={memberItems}
				bind:value={memberSearchValue}
				placeholder="พิมพ์ชื่อ, เบอร์ หรือเลขบัตรเพื่อค้นหา..."
				searchPlaceholder="ค้นหาผู้ประสบภัย..."
				emptyText="ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา"
				class="h-9 w-full"
			>
				{#snippet children({ item })}
					<div class="flex w-full items-center justify-between gap-2">
						<div class="flex flex-col">
							<span class="font-medium">{item.evacuee.first_name} {item.evacuee.last_name}</span>
							<span class="text-[10px] text-muted-foreground">
								ID: {maskNationalId(item.evacuee.person_id?.number) || 'ไม่มี'} · โทร: {item.evacuee
									.phone || 'ไม่มี'}
							</span>
						</div>
						{#if item.hasOther}
							<span
								class="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400"
							>
								ย้ายจาก: {item.otherLabel}
							</span>
						{/if}
					</div>
				{/snippet}
			</Combobox>

			{#if selectedMemberIds.length > 0}
				<div class="flex flex-wrap gap-2 rounded-md border border-border/50 bg-muted/10 p-2">
					{#each selectedMemberIds as memberId (memberId)}
						{@const member = allEvacuees.find((e) => e._id === memberId)}
						{#if member}
							{@const hasOther = member.household_id && member.household_id !== initialData?._id}
							{@const otherLabel =
								households.find((h) => h._id === member.household_id)?.label ?? 'ครัวเรือนอื่น'}
							<div
								class="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
							>
								<span>{member.first_name} {member.last_name}</span>
								{#if hasOther}
									<span
										class="rounded border border-amber-200 bg-amber-50 px-1 text-[9px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400"
									>
										ย้ายจาก: {otherLabel}
									</span>
								{/if}
								{#if $formData.head_evacuee_id === memberId}
									<span
										class="rounded border border-primary/20 bg-primary/10 px-1 text-[9px] font-semibold text-primary"
									>
										หัวหน้า
									</span>
								{/if}
								<button
									type="button"
									class="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
									aria-label="ลบสมาชิก"
									onclick={() => removeMember(memberId)}
								>
									<X class="size-3" />
								</button>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<!-- ─────────────────────── เขต / ชุมชน ─────────────────────── -->
		<div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
			<h3
				class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
			>
				<MapPin class="size-3.5" />
				ที่อยู่เดิม (เขต / ชุมชน)
			</h3>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Form.Field {form} name="municipality_zone">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เขตเทศบาล</Form.Label>
							<Combobox
								{...props}
								items={municipalityZoneItems}
								bind:value={mzVal}
								placeholder={municipalityZoneQuery.isPending ? 'กำลังโหลด...' : 'เลือกเขต...'}
								searchPlaceholder="ค้นหาเขต..."
								emptyText="ไม่พบเขตที่ค้นหา"
								disabled={municipalityZoneQuery.isPending}
								class="h-9 w-full"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="community">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ชุมชน</Form.Label>
							<Combobox
								{...props}
								items={communityItems}
								bind:value={commVal}
								placeholder={communityQuery.isPending ? 'กำลังโหลด...' : 'เลือกชุมชน...'}
								searchPlaceholder="ค้นหาชุมชน..."
								emptyText="ไม่พบชุมชนที่ค้นหา"
								disabled={communityQuery.isPending}
								class="h-9 w-full"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</div>

		<!-- ─────────────────────── สัตว์เลี้ยง ─────────────────────── -->
		<Form.Field {form} name="pets">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="flex items-center gap-1.5">
						<PawPrint class="size-3.5 text-muted-foreground" />
						สัตว์เลี้ยง
					</Form.Label>
					<div {...props} class="mt-1 grid grid-cols-2 gap-2.5">
						{#each [{ label: '🐶 สุนัข', bind: dogCount }, { label: '🐱 แมว', bind: catCount }, { label: '🐦 นก', bind: birdCount }, { label: '🐾 อื่นๆ', bind: otherCount }] as pet, i (i)}
							<div
								class="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
							>
								<span class="text-sm font-medium">{pet.label}</span>
								{#if i === 0}
									<Input
										type="number"
										min="0"
										bind:value={dogCount}
										class="h-8 w-16 px-1 text-center"
									/>
								{:else if i === 1}
									<Input
										type="number"
										min="0"
										bind:value={catCount}
										class="h-8 w-16 px-1 text-center"
									/>
								{:else if i === 2}
									<Input
										type="number"
										min="0"
										bind:value={birdCount}
										class="h-8 w-16 px-1 text-center"
									/>
								{:else}
									<Input
										type="number"
										min="0"
										bind:value={otherCount}
										class="h-8 w-16 px-1 text-center"
									/>
								{/if}
							</div>
						{/each}
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- ─────────────────────── ที่อยู่ครอบครัวหลัก ─────────────────────── -->
		<div class="space-y-3 border-t border-border/50 pt-4">
			<h3 class="text-xs font-semibold tracking-wide text-primary uppercase">
				ที่อยู่ครอบครัวหลัก
			</h3>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Form.Field {form} name="address_no">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>บ้านเลขที่</Form.Label>
							<Input {...props} bind:value={$formData.address_no} placeholder="เช่น 123/45" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="village_no">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>หมู่ / ตรอก / ซอย / ถนน</Form.Label>
							<Input {...props} bind:value={$formData.village_no} placeholder="เช่น หมู่ 2" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="subdistrict">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ตำบล / แขวง</Form.Label>
							<Input {...props} bind:value={$formData.subdistrict} placeholder="เช่น หาดใหญ่" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Form.Field {form} name="district">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>อำเภอ / เขต</Form.Label>
							<Input {...props} bind:value={$formData.district} placeholder="เช่น หาดใหญ่" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="province">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>จังหวัด</Form.Label>
							<Input {...props} bind:value={$formData.province} placeholder="เช่น สงขลา" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="postal_code">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>รหัสไปรษณีย์</Form.Label>
							<Input {...props} bind:value={$formData.postal_code} placeholder="เช่น 90110" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</div>

		<!-- ─────────────────────── บันทึกเพิ่มเติม ─────────────────────── -->
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

		<!-- ─────────────────────── Actions ─────────────────────── -->
		<div class="flex justify-end gap-2 pt-2">
			<Button type="button" variant="outline" onclick={oncancel}>ยกเลิก</Button>
			<Form.Button disabled={$submitting || pending}>
				{pending ? 'กำลังบันทึก...' : 'บันทึก'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>

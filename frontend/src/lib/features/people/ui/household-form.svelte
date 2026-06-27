<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import X from '@lucide/svelte/icons/x';
	import { maskNationalId, MUNICIPALITY_ZONES, COMMUNITIES } from '../domain/people';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { householdInputSchema } from '../domain/people';

	let {
		onsubmit,
		oncancel,
		pending = false,
		initialData = null,
		allEvacuees = [],
		zones = [],
		households = [],
		initialMemberIds = []
	}: {
		onsubmit: (input: HouseholdInput, selectedMemberIds: string[], emergencyContactPhone?: string) => void;
		oncancel: () => void;
		pending?: boolean;
		initialData?: Household | null;
		allEvacuees?: Evacuee[];
		zones?: { code: string; name: string }[];
		households?: Household[];
		initialMemberIds?: string[];
	} = $props();

	const form = superForm(defaults(zod4(householdInputSchema)), {
		SPA: true,
		validators: zod4(householdInputSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;

			if ($formData.head_evacuee_id && !emergencyContactPhone.trim()) {
				return;
			}

			onsubmit(form.data, selectedMemberIds, emergencyContactPhone.trim());
		}
	});

	const { form: formData, submitting } = form;

	// Modal Form State
	let dogCount = $state(0);
	let catCount = $state(0);
	let birdCount = $state(0);
	let otherCount = $state(0);
	let selectedMemberIds = $state<string[]>([]);

	// Dropdown Search Member State
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let containerDiv = $state<HTMLDivElement | null>(null);
	let emergencyContactPhone = $state('');

	// Reset community if it does not belong to selected zone
	$effect(() => {
		const zone = $formData.municipality_zone;
		const comm = $formData.community;
		if (comm) {
			const opt = COMMUNITIES.find((c) => c.code === comm);
			if (!opt || opt.parent_code !== zone) {
				$formData.community = null;
			}
		}
	});

	// Pre-fill state when initialData is provided
	$effect(() => {
		if (initialData) {
			$formData.label = initialData.label;
			$formData.municipality_zone = initialData.municipality_zone;
			$formData.community = initialData.community;
			$formData.head_evacuee_id = initialData.head_evacuee_id;
			$formData.notes = initialData.notes ?? '';
			$formData.address_no = initialData.address_no ?? '';
			$formData.village_no = initialData.village_no ?? '';
			$formData.subdistrict = initialData.subdistrict ?? '';
			$formData.district = initialData.district ?? '';
			$formData.province = initialData.province ?? '';
			$formData.postal_code = initialData.postal_code ?? '';
			dogCount = initialData.pets.find((p) => p.species === 'dog')?.count ?? 0;
			catCount = initialData.pets.find((p) => p.species === 'cat')?.count ?? 0;
			birdCount = initialData.pets.find((p) => p.species === 'bird')?.count ?? 0;
			otherCount = initialData.pets.find((p) => p.species === 'other')?.count ?? 0;
			selectedMemberIds = allEvacuees.filter((e) => e.household_id === initialData._id).map((e) => e._id);
		} else {
			$formData.label = '';
			$formData.municipality_zone = null;
			$formData.community = null;
			$formData.head_evacuee_id = null;
			$formData.notes = '';
			$formData.address_no = '';
			$formData.village_no = '';
			$formData.subdistrict = '';
			$formData.district = '';
			$formData.province = '';
			$formData.postal_code = '';
			dogCount = 0;
			catCount = 0;
			birdCount = 0;
			otherCount = 0;
			selectedMemberIds = [...initialMemberIds];
		}
	});

	// Sync pets array in form data reactively
	$effect(() => {
		const petGroups = [];
		if (dogCount > 0) petGroups.push({ species: 'dog' as const, count: dogCount });
		if (catCount > 0) petGroups.push({ species: 'cat' as const, count: catCount });
		if (birdCount > 0) petGroups.push({ species: 'bird' as const, count: birdCount });
		if (otherCount > 0) petGroups.push({ species: 'other' as const, count: otherCount });
		$formData.pets = petGroups;
	});

	// Sync head of household selection to selected members
	$effect(() => {
		if ($formData.head_evacuee_id && !selectedMemberIds.includes($formData.head_evacuee_id)) {
			selectedMemberIds = [...selectedMemberIds, $formData.head_evacuee_id];
		}
	});

	// Sync emergency contact phone when formHead changes
	$effect(() => {
		if ($formData.head_evacuee_id) {
			const headEvac = allEvacuees.find((e) => e._id === $formData.head_evacuee_id);
			emergencyContactPhone = headEvac?.emergency_contact?.phone ?? '';
		} else {
			emergencyContactPhone = '';
		}
	});

	let filteredEvacuees = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		return allEvacuees.filter((e) => {
			if (selectedMemberIds.includes(e._id)) return false;
			if (!q) return true;
			const firstName = (e.first_name || '').toLowerCase();
			const lastName = (e.last_name || '').toLowerCase();
			const nickname = (e.nickname || '').toLowerCase();
			const phone = (e.phone || '').toLowerCase();
			const nationalId = (e.person_id?.number || '').toLowerCase();
			return (
				firstName.includes(q) ||
				lastName.includes(q) ||
				nickname.includes(q) ||
				phone.includes(q) ||
				nationalId.includes(q)
			);
		});
	});

	function handleFocusOut(e: FocusEvent) {
		if (containerDiv && !containerDiv.contains(e.relatedTarget as Node)) {
			isDropdownOpen = false;
		}
	}

	function selectMember(id: string) {
		if (!selectedMemberIds.includes(id)) {
			selectedMemberIds = [...selectedMemberIds, id];
		}
		searchQuery = '';
		isDropdownOpen = false;
	}

	function removeMember(id: string) {
		selectedMemberIds = selectedMemberIds.filter((mId) => mId !== id);
		// Clear head of household if they are deselected from members
		if ($formData.head_evacuee_id === id) {
			$formData.head_evacuee_id = null;
		}
	}
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<Form.Field {form} name="label">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชื่อเรียกครัวเรือน (เช่น บ้านสมชาย, ครอบครัวใจดี)</Form.Label>
					<Input {...props} bind:value={$formData.label} placeholder="ระบุชื่อครัวเรือน..." required />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="municipality_zone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เขตเทศบาล (ที่อยู่เดิม)</Form.Label>
					<select
						{...props}
						bind:value={$formData.municipality_zone}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value={null}>กรุณาเลือกเขต...</option>
						{#each MUNICIPALITY_ZONES as mz}
							<option value={mz.code}>{mz.label}</option>
						{/each}
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="community">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชุมชน (ที่อยู่เดิม)</Form.Label>
					<select
						{...props}
						bind:value={$formData.community}
						disabled={!$formData.municipality_zone}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
					>
						<option value={null}>กรุณาเลือกชุมชน...</option>
						{#each COMMUNITIES.filter(c => c.parent_code === $formData.municipality_zone) as c}
							<option value={c.code}>{c.label}</option>
						{/each}
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="head_evacuee_id">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หัวหน้าครัวเรือน</Form.Label>
					<select
						{...props}
						bind:value={$formData.head_evacuee_id}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value={null}>ไม่มีหัวหน้าครัวเรือน (None)</option>
						{#each allEvacuees as e}
							<option value={e._id}>{e.first_name} {e.last_name} ({maskNationalId(e.person_id?.number)})</option>
						{/each}
					</select>
				{/snippet}
			</Form.Control>
			<Form.Description>หัวหน้าครัวเรือนจะถูกเลือกจากรายชื่อผู้ประสบภัยทั้งหมดในระบบ</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		{#if $formData.head_evacuee_id}
			{@const headEvac = allEvacuees.find((e) => e._id === $formData.head_evacuee_id)}
			{#if headEvac}
				<div class="flex flex-col gap-1.5 p-3.5 bg-primary/5 border border-primary/10 rounded-lg">
					<Label for="emergency-phone" class="text-xs font-bold text-primary uppercase tracking-wider">
						เบอร์ติดต่อฉุกเฉิน (Emergency Contact Phone) ของหัวหน้าครัวเรือน
					</Label>
					<Input
						id="emergency-phone"
						type="tel"
						placeholder="ระบุเบอร์โทรศัพท์..."
						bind:value={emergencyContactPhone}
						class="bg-background mt-1"
						required
					/>
					<p class="text-[11px] text-muted-foreground mt-0.5">
						เบอร์นี้จะถูกบันทึกในข้อมูลผู้ติดต่อฉุกเฉินของ {headEvac.first_name} {headEvac.last_name}
					</p>
				</div>
			{/if}
		{/if}

		<div class="flex flex-col gap-1.5">
			<Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
				เลือกสมาชิกในครัวเรือน
			</Label>
			
			<div class="relative w-full" bind:this={containerDiv} onfocusout={handleFocusOut}>
				<Input
					type="text"
					placeholder="พิมพ์เพื่อค้นหาชื่อสมาชิก..."
					bind:value={searchQuery}
					onfocus={() => isDropdownOpen = true}
					class="w-full bg-background"
				/>
				
				{#if isDropdownOpen}
					<div class="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1">
						{#if filteredEvacuees.length === 0}
							<p class="text-xs text-muted-foreground p-2">ไม่พบผู้ประสบภัยที่ตรงกับการค้นหา</p>
						{:else}
							{#each filteredEvacuees as e (e._id)}
								{@const hasOtherHousehold = e.household_id && e.household_id !== initialData?._id}
								{@const otherHouseholdLabel = households.find((h) => h._id === e.household_id)?.label ?? 'ครัวเรือนอื่น'}
								<button
									type="button"
									onclick={() => selectMember(e._id)}
									class="flex w-full items-center justify-between gap-2 text-left text-sm px-3 py-2 hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors cursor-pointer"
								>
									<div class="flex flex-col">
										<span class="font-medium text-foreground">
											{e.first_name} {e.last_name}
										</span>
										<span class="text-[10px] text-muted-foreground">
											ID: {maskNationalId(e.person_id?.number) || 'ไม่มี'} | โทร: {e.phone || 'ไม่มี'}
										</span>
									</div>
									{#if hasOtherHousehold}
										<span class="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 px-1.5 py-0.5 rounded shrink-0">
											ย้ายจาก: {otherHouseholdLabel}
										</span>
									{/if}
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Chips of selected members -->
			{#if selectedMemberIds.length > 0}
				<div class="flex flex-wrap gap-2 mt-1 p-2 border border-border/50 rounded-md bg-muted/10">
					{#each selectedMemberIds as id (id)}
						{@const member = allEvacuees.find((e) => e._id === id)}
						{#if member}
							{@const hasOtherHousehold = member.household_id && member.household_id !== initialData?._id}
							{@const otherHouseholdLabel = households.find((h) => h._id === member.household_id)?.label ?? 'ครัวเรือนอื่น'}
							<div class="flex items-center gap-1.5 bg-secondary text-secondary-foreground text-xs font-medium px-2.5 py-1 rounded-full border border-border">
								<span>{member.first_name} {member.last_name}</span>
								{#if hasOtherHousehold}
									<span class="text-[9px] text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 px-1 rounded">
										ย้ายจาก: {otherHouseholdLabel}
									</span>
								{/if}
								{#if $formData.head_evacuee_id === id}
									<span class="text-[9px] text-primary bg-primary/10 dark:bg-primary/20 px-1 rounded border border-primary/20 font-semibold">
										หัวหน้า
									</span>
								{/if}
								<button
									type="button"
									class="text-muted-foreground hover:text-foreground rounded-full p-0.5 transition-colors focus:outline-none cursor-pointer"
									aria-label="ลบสมาชิก"
									onclick={() => removeMember(id)}
								>
									<X class="size-3" />
								</button>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<Form.Field {form} name="pets">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สัตว์เลี้ยงในครอบครัว</Form.Label>
					<div class="grid grid-cols-2 gap-3 mt-1">
						<div class="flex items-center justify-between border border-border rounded-lg p-2 bg-muted/30">
							<span class="text-sm font-medium">🐶 สุนัข (Dog)</span>
							<Input
								type="number"
								min="0"
								bind:value={dogCount}
								class="w-16 h-8 text-center px-1"
							/>
						</div>

						<div class="flex items-center justify-between border border-border rounded-lg p-2 bg-muted/30">
							<span class="text-sm font-medium">🐱 แมว (Cat)</span>
							<Input
								type="number"
								min="0"
								bind:value={catCount}
								class="w-16 h-8 text-center px-1"
							/>
						</div>

						<div class="flex items-center justify-between border border-border rounded-lg p-2 bg-muted/30">
							<span class="text-sm font-medium">🐦 นก (Bird)</span>
							<Input
								type="number"
								min="0"
								bind:value={birdCount}
								class="w-16 h-8 text-center px-1"
							/>
						</div>

						<div class="flex items-center justify-between border border-border rounded-lg p-2 bg-muted/30">
							<span class="text-sm font-medium">🐾 อื่นๆ (Other)</span>
							<Input
								type="number"
								min="0"
								bind:value={otherCount}
								class="w-16 h-8 text-center px-1"
							/>
						</div>
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="space-y-4 border-t border-border/50 pt-4 mt-2">
			<h3 class="text-xs font-bold text-primary uppercase tracking-wider">ที่อยู่ครอบครัวหลัก</h3>
			
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Form.Field {form} name="address_no">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>บ้านเลขที่</Form.Label>
							<Input {...props} bind:value={$formData.address_no} placeholder="เช่น 123/45" class="bg-background" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="village_no">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>หมู่ที่ / ตรอก / ซอย / ถนน</Form.Label>
							<Input {...props} bind:value={$formData.village_no} placeholder="เช่น หมู่ 2" class="bg-background" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="subdistrict">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ตำบล / แขวง</Form.Label>
							<Input {...props} bind:value={$formData.subdistrict} placeholder="เช่น หาดใหญ่" class="bg-background" />
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
							<Input {...props} bind:value={$formData.district} placeholder="เช่น หาดใหญ่" class="bg-background" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="province">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>จังหวัด</Form.Label>
							<Input {...props} bind:value={$formData.province} placeholder="เช่น สงขลา" class="bg-background" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="postal_code">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>รหัสไปรษณีย์</Form.Label>
							<Input {...props} bind:value={$formData.postal_code} placeholder="เช่น 90110" class="bg-background" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<p class="text-[11px] text-muted-foreground italic">
				* การแก้ไขที่อยู่จะอัปเดตข้อมูลของทุกคนในครอบครัวอัตโนมัติ
			</p>
		</div>

		<Form.Field {form} name="notes">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>บันทึกเพิ่มเติม</Form.Label>
					<textarea
						{...props}
						bind:value={$formData.notes}
						placeholder="ข้อมูลเพิ่มเติม เช่น เบอร์ติดต่อสำรอง, ปัญหาสุขภาพของสัตว์เลี้ยง..."
						class="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					></textarea>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="flex justify-end gap-2 pt-3">
			<Button type="button" variant="outline" onclick={oncancel}>ยกเลิก</Button>
			<Form.Button disabled={$submitting || pending}>บันทึก</Form.Button>
		</div>
	</Field.FieldGroup>
</form>

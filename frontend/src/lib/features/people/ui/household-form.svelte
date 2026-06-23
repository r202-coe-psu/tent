<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import X from '@lucide/svelte/icons/x';
	import { maskNationalId } from '../domain/people';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';

	let {
		onsubmit,
		oncancel,
		pending = false,
		initialData = null,
		allEvacuees = [],
		zones = [],
		households = []
	}: {
		onsubmit: (input: HouseholdInput, selectedMemberIds: string[], emergencyContactPhone?: string) => void;
		oncancel: () => void;
		pending?: boolean;
		initialData?: Household | null;
		allEvacuees?: Evacuee[];
		zones?: { code: string; name: string }[];
		households?: Household[];
	} = $props();

	// Modal Form State
	let formLabel = $state('');
	let formZone = $state<string | null>(null);
	let formHead = $state<string | null>(null);
	let formNotes = $state('');
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

	// Pre-fill state when initialData is provided
	$effect(() => {
		if (initialData) {
			formLabel = initialData.label;
			formZone = initialData.zone;
			formHead = initialData.head_evacuee_id;
			formNotes = initialData.notes ?? '';
			dogCount = initialData.pets.find((p) => p.species === 'dog')?.count ?? 0;
			catCount = initialData.pets.find((p) => p.species === 'cat')?.count ?? 0;
			birdCount = initialData.pets.find((p) => p.species === 'bird')?.count ?? 0;
			otherCount = initialData.pets.find((p) => p.species === 'other')?.count ?? 0;
			selectedMemberIds = allEvacuees.filter((e) => e.household_id === initialData._id).map((e) => e._id);
		} else {
			formLabel = '';
			formZone = null;
			formHead = null;
			formNotes = '';
			dogCount = 0;
			catCount = 0;
			birdCount = 0;
			otherCount = 0;
			selectedMemberIds = [];
		}
	});

	// Sync head of household selection to selected members
	$effect(() => {
		if (formHead && !selectedMemberIds.includes(formHead)) {
			selectedMemberIds = [...selectedMemberIds, formHead];
		}
	});

	// Sync emergency contact phone when formHead changes
	$effect(() => {
		if (formHead) {
			const headEvac = allEvacuees.find((e) => e._id === formHead);
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
			const nationalId = (e.national_id || '').toLowerCase();
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
		if (formHead === id) {
			formHead = null;
		}
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending) return;

		if (formHead && !emergencyContactPhone.trim()) {
			return;
		}

		const petGroups = [];
		if (dogCount > 0) petGroups.push({ species: 'dog' as const, count: dogCount });
		if (catCount > 0) petGroups.push({ species: 'cat' as const, count: catCount });
		if (birdCount > 0) petGroups.push({ species: 'bird' as const, count: birdCount });
		if (otherCount > 0) petGroups.push({ species: 'other' as const, count: otherCount });

		const input: HouseholdInput = {
			label: formLabel.trim(),
			head_evacuee_id: formHead,
			zone: formZone,
			pets: petGroups,
			notes: formNotes.trim() || undefined
		};

		onsubmit(input, selectedMemberIds, emergencyContactPhone.trim());
	}
</script>

<form onsubmit={handleSubmit} class="space-y-4">
	<div class="flex flex-col gap-1.5">
		<Label for="label" class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
			ชื่อเรียกครัวเรือน (เช่น บ้านสมชาย, ครอบครัวใจดี)
		</Label>
		<Input id="label" bind:value={formLabel} placeholder="ระบุชื่อครัวเรือน..." required />
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="zone" class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
			โซนพักของครัวเรือน
		</Label>
		<select
			id="zone"
			bind:value={formZone}
			class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
		>
			<option value={null}>ไม่มีการจัดสรร (None)</option>
			{#each zones as z}
				<option value={z.code}>{z.name} ({z.code})</option>
			{/each}
		</select>
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="head" class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
			หัวหน้าครัวเรือน
		</Label>
		<select
			id="head"
			bind:value={formHead}
			class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
		>
			<option value={null}>ไม่มีหัวหน้าครัวเรือน (None)</option>
			{#each allEvacuees as e}
				<option value={e._id}>{e.first_name} {e.last_name} ({maskNationalId(e.national_id)})</option>
			{/each}
		</select>
		<p class="text-[11px] text-muted-foreground">หัวหน้าครัวเรือนจะถูกเลือกจากรายชื่อผู้ประสบภัยทั้งหมดในระบบ</p>
	</div>

	{#if formHead}
		{@const headEvac = allEvacuees.find((e) => e._id === formHead)}
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
										ID: {maskNationalId(e.national_id) || 'ไม่มี'} | โทร: {e.phone || 'ไม่มี'}
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
							{#if formHead === id}
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

	<div class="space-y-2">
		<Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
			สัตว์เลี้ยงในครอบครัว
		</Label>

		<div class="grid grid-cols-2 gap-3">
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
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="notes" class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
			บันทึกเพิ่มเติม
		</Label>
		<textarea
			id="notes"
			bind:value={formNotes}
			placeholder="ข้อมูลเพิ่มเติม เช่น เบอร์ติดต่อสำรอง, ปัญหาสุขภาพของสัตว์เลี้ยง..."
			class="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		></textarea>
	</div>

	<div class="flex justify-end gap-2 pt-3">
		<Button type="button" variant="outline" onclick={oncancel}>ยกเลิก</Button>
		<Button type="submit" disabled={pending}>บันทึก</Button>
	</div>
</form>

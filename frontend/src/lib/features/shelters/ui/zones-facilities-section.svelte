<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Zone, Shelter, ZoneType, SubStorageType } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCloseZone, useReopenZone } from '../application/queries';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Power from '@lucide/svelte/icons/power';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	let {
		form,
		formData,
		shelterCode = '',
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		shelterCode?: string;
		disabled?: boolean;
	} = $props();

	const closeZoneMutation = useCloseZone();
	const reopenZoneMutation = useReopenZone();

	// Confirmation modal state for close/reopen
	let confirmAction = $state<'close' | 'reopen' | null>(null);
	let confirmZoneCode = $state<string>('');
	let confirmIndex = $state<number>(-1);
	let confirmReason = $state<string>('');
	let confirmOpen = $derived(confirmAction !== null);

	function openConfirm(action: 'close' | 'reopen', zoneCode: string, index: number) {
		if (!shelterCode) {
			toast.error(action === 'close' ? 'บันทึกศูนย์พักพิงก่อนปิดโซน' : 'บันทึกศูนย์พักพิงก่อนเปิดโซน');
			return;
		}
		confirmAction = action;
		confirmZoneCode = zoneCode;
		confirmIndex = index;
		confirmReason = '';
	}

	function cancelConfirm() {
		confirmAction = null;
		confirmZoneCode = '';
		confirmIndex = -1;
		confirmReason = '';
	}

	function submitConfirm() {
		if (!confirmAction || confirmIndex < 0) return;
		const action = confirmAction;
		const index = confirmIndex;
		const zoneCode = confirmZoneCode;
		const reason = confirmReason.trim();
		const actor = authStore.user?.name ?? null;

		if (action === 'close') {
			closeZoneMutation.mutate(
				{ code: shelterCode, zoneCode, reason: reason || undefined, closedBy: actor ?? undefined },
				{
					onSuccess: () => {
						$formData.zones = $formData.zones.map((z, i) =>
							i === index ? { ...z, status: 'closed' as const } : z
						);
					}
				}
			);
		} else {
			reopenZoneMutation.mutate(
				{ code: shelterCode, zoneCode, reopenedBy: actor ?? undefined },
				{
					onSuccess: () => {
						$formData.zones = $formData.zones.map((z, i) =>
							i === index ? { ...z, status: 'active' as const } : z
						);
					}
				}
			);
		}
		cancelConfirm();
	}

	const zoneTypeOptions: { value: ZoneType; label: string }[] = [
		{ value: 'general', label: 'ทั่วไป' },
		{ value: 'male', label: 'ชายล้วน' },
		{ value: 'female', label: 'หญิงล้วน' },
		{ value: 'vulnerable', label: 'เปราะบาง' },
		{ value: 'pet', label: 'สัตว์เลี้ยง' },
		{ value: 'quarantine', label: 'กักโรค' }
	];

	function addNewZone() {
		const zones = $formData.zones ?? [];
		let newCode = `Z${zones.length + 1}`;
		while (zones.some((z: Zone) => z.code === newCode)) {
			newCode = `Z${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
		}
		$formData.zones = [
			...zones,
			{
				code: newCode,
				name: '',
				capacity: 0,
				type: 'general' as ZoneType,
				status: 'active' as const,
				closed_at: null,
				closed_by: null,
				reason: null
			}
		];
		toast.success('เพิ่มโซนสำเร็จ');
	}

	function deleteZone(index: number) {
		$formData.zones = $formData.zones.filter((_: Zone, i: number) => i !== index);
		toast.success('ลบโซนสำเร็จ');
	}

	// Sub-storage editing
	const subStorageOptions: { value: SubStorageType; label: string }[] = [
		{ value: 'general', label: 'ทั่วไป' },
		{ value: 'food_dry', label: 'อาหารแห้ง' },
		{ value: 'drinking_water', label: 'น้ำดื่ม' },
		{ value: 'medical_supplies', label: 'เวชภัณฑ์' }
	];

	let newSubStorageName = $state('');
	let newSubStorageType = $state<SubStorageType>('general');

	function addSubStorage() {
		if (!newSubStorageName.trim()) {
			toast.error('กรุณากรอกชื่อสถานที่จัดเก็บ');
			return;
		}
		const current = $formData.common_areas.sub_storage ?? [];
		$formData.common_areas = {
			...$formData.common_areas,
			sub_storage: [...current, { name: newSubStorageName.trim(), type: newSubStorageType }]
		};
		newSubStorageName = '';
		newSubStorageType = 'general';
	}

	function removeSubStorage(index: number) {
		const current = $formData.common_areas.sub_storage ?? [];
		$formData.common_areas = {
			...$formData.common_areas,
			sub_storage: current.filter((_item: unknown, i: number) => i !== index)
		};
	}
</script>

<section
	class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border bg-amber-50/30 p-6 shadow-sm"
>
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="bg-shelter-orange-bg text-shelter-orange-text flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
			>3</span
		>
		<h2 class="text-base font-bold text-card-foreground">การจัดการโซนและสิ่งอำนวยความสะดวก</h2>
	</div>
	<!-- 3a. Living Zones -->

	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<div
			class="sticky top-[72px] z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between rounded-t-xl border-b border-shelter-border bg-background/95 p-5 backdrop-blur-sm"
		>
			<h3 class="text-sm font-bold text-card-foreground">การตั้งค่าโซนที่พัก (Living Zones)</h3>
			<Button
				variant="outline"
				size="sm"
				onclick={addNewZone}
				{disabled}
				class="rounded-full border-orange-200 bg-orange-50 text-orange-600 shadow-sm hover:bg-orange-100 hover:text-orange-700"
			>
				<Plus class="mr-1 h-4 w-4" /> เพิ่มโซน
			</Button>
		</div>

		<div class="space-y-3">
			<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
			{#each $formData.zones ?? [] as _, index (index)}
				<div
					class="flex items-center gap-3 rounded-xl border border-shelter-border bg-muted/30 p-2"
				>
					<Form.Field {form} name={`zones[${index}].name`} class="flex-1 space-y-0">
						<Form.Control>
							{#snippet children({ props })}
								<Input
									{...props}
									bind:value={$formData.zones[index].name}
									placeholder="ชื่อโซน"
									class="bg-white"
									{disabled}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Select.Root type="single" bind:value={$formData.zones[index].type} {disabled}>
						<Select.Trigger
							class="flex !h-9 w-[200px] items-start rounded-md border border-input bg-white px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
						>
							{zoneTypeOptions.find((o) => o.value === $formData.zones[index].type)?.label ??
								'— เลือก —'}
						</Select.Trigger>
						<Select.Content>
							{#each zoneTypeOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
					<Form.Field {form} name={`zones[${index}].capacity`} class="w-[140px] space-y-0">
						<Form.Control>
							{#snippet children({ props })}
								<div class="relative">
									<Input
										{...props}
										type="number"
										bind:value={$formData.zones[index].capacity}
										class="bg-white pr-10 text-right"
										{disabled}
									/>
									<span
										class="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
										>คน</span
									>
								</div>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Button
						variant="ghost"
						size="icon"
						class="text-destructive hover:bg-destructive/10 hover:text-destructive"
						onclick={() => deleteZone(index)}
						{disabled}
						title="ลบโซน"
					>
						<Trash2 class="h-4 w-4" />
					</Button>
					{#if $formData.zones[index].status === 'closed'}
						<Button
							variant="ghost"
							size="icon"
							class="text-green-600 hover:bg-green-50 hover:text-green-700"
							onclick={() => openConfirm('reopen', $formData.zones[index].code, index)}
							{disabled}
							title="เปิดโซนอีกครั้ง"
						>
							<RotateCcw class="h-4 w-4" />
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="icon"
							class="text-orange-600 hover:bg-orange-50 hover:text-orange-700"
							onclick={() => openConfirm('close', $formData.zones[index].code, index)}
							{disabled}
							title="ปิดโซน"
						>
							<Power class="h-4 w-4" />
						</Button>
					{/if}
				</div>
			{/each}
			{#if ($formData.zones ?? []).length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">ยังไม่มีโซน กรุณาเพิ่มโซนใหม่</p>
			{/if}
		</div>
	</div>

	<!-- 3b. WASH Facilities -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
			ข้อมูลห้องน้ำและสุขอนามัย (WASH Facilities)
		</h3>

		<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
			<Form.Field {form} name="facilities.toilets_male">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚹 ห้องน้ำชาย</Form.Label>
						<div class="flex">
							<Input
								{...props}
								type="number"
								min="0"
								value={$formData.facilities.toilets_male ?? ''}
								oninput={(e) =>
									($formData.facilities.toilets_male =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								{disabled}
								placeholder="0"
								class="rounded-r-none"
							/>
							<span
								class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
								>ห้อง</span
							>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.toilets_female">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚺 ห้องน้ำหญิง</Form.Label>
						<div class="flex">
							<Input
								{...props}
								type="number"
								min="0"
								value={$formData.facilities.toilets_female ?? ''}
								oninput={(e) =>
									($formData.facilities.toilets_female =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								{disabled}
								placeholder="0"
								class="rounded-r-none"
							/>
							<span
								class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
								>ห้อง</span
							>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.toilets_accessible">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>♿ ห้องน้ำคนพิการ</Form.Label>
						<div class="flex">
							<Input
								{...props}
								type="number"
								min="0"
								value={$formData.facilities.toilets_accessible ?? ''}
								oninput={(e) =>
									($formData.facilities.toilets_accessible =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								{disabled}
								placeholder="0"
								class="rounded-r-none"
							/>
							<span
								class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
								>ห้อง</span
							>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="facilities.showers">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>🚿 ห้องอาบน้ำ</Form.Label>
						<div class="flex">
							<Input
								{...props}
								type="number"
								min="0"
								value={$formData.facilities.showers ?? ''}
								oninput={(e) =>
									($formData.facilities.showers =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								{disabled}
								placeholder="0"
								class="rounded-r-none"
							/>
							<span
								class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
								>ห้อง</span
							>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<label class="flex items-center space-x-2 text-sm">
			<Checkbox
				bind:checked={
					() => $formData.facilities.car_toilet_accessible ?? false,
					(v) => ($formData.facilities.car_toilet_accessible = v)
				}
				{disabled}
			/>
			<span>✅ รถสุขาเคลื่อนที่สามารถเข้าถึงได้</span>
		</label>
	</div>

	<!-- 3c. Common Areas -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-background p-5">
		<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
			ข้อมูลพื้นที่ส่วนกลาง (Common Areas)
		</h3>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<label
				class="flex items-center space-x-2 rounded-lg border border-shelter-border p-3 text-sm"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.central_kitchen ?? false,
						(v) => ($formData.common_areas.central_kitchen = v)
					}
					{disabled}
				/>
				<span>👨‍🍳 ลานประกอบอาหาร (ครัวกลาง)</span>
			</label>
			<label
				class="flex items-center space-x-2 rounded-lg border border-shelter-border p-3 text-sm"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.helipad ?? false,
						(v) => ($formData.common_areas.helipad = v)
					}
					{disabled}
				/>
				<span>🚁 พื้นที่จอดเฮลิคอปเตอร์ (Helipad)</span>
			</label>
		</div>

		<div>
			<div class="mb-1 block text-xs font-bold text-muted-foreground">
				📦 คลังย่อยและสถานที่จัดเก็บ
			</div>
			{#if ($formData.common_areas.sub_storage ?? []).length > 0}
				<div class="mb-2 space-y-1">
					{#each $formData.common_areas.sub_storage ?? [] as item, i (i)}
						<div
							class="flex items-center justify-between rounded-lg border border-shelter-border p-2 text-sm"
						>
							<div class="flex items-center gap-2">
								<span class="font-medium">{item.name}</span>
								<span class="text-xs text-muted-foreground">
									({subStorageOptions.find((o) => o.value === item.type)?.label ?? item.type})
								</span>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onclick={() => removeSubStorage(i)}
								{disabled}
								title="ลบ"
							>
								<Trash2 class="h-3.5 w-3.5 text-destructive" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex gap-2">
				<Input
					bind:value={newSubStorageName}
					{disabled}
					placeholder="ชื่อสถานที่จัดเก็บ (เช่น อาหารแห้ง (เสธียง))"
					class="flex-1"
				/>
				<Select.Root type="single" bind:value={newSubStorageType} {disabled}>
					<Select.Trigger
						class="flex !h-9 w-[180px] items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
					>
						{subStorageOptions.find((o) => o.value === newSubStorageType)?.label ?? '— เลือก —'}
					</Select.Trigger>
					<Select.Content>
						{#each subStorageOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				<Button type="button" size="sm" onclick={addSubStorage} {disabled}>
					<Plus class="h-3.5 w-3.5" />
					เพิ่ม
				</Button>
			</div>
		</div>

		<Form.Field {form} name="common_areas.parking_capacity">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>🚗 พื้นที่จอดรถ (คัน)</Form.Label>
					<Input
						{...props}
						type="number"
						min="0"
						value={$formData.common_areas.parking_capacity ?? ''}
						oninput={(e) =>
							($formData.common_areas.parking_capacity =
								e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
						{disabled}
						placeholder="0"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Dialog.Root open={confirmOpen} onOpenChange={(open) => !open && cancelConfirm()}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>
					{confirmAction === 'close' ? `ปิดโซน ${confirmZoneCode}` : `เปิดโซน ${confirmZoneCode} อีกครั้ง`}
				</Dialog.Title>
				<Dialog.Description>
					{confirmAction === 'close'
						? 'โซนนี้จะไม่รับการ assign ใหม่ (ผู้อยู่เดิมไม่ถูกย้ายออก)'
						: 'โซนนี้จะกลับมารับการ assign อีกครั้ง'}
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-2 py-2">
				<Label for="zone-action-reason" class="text-sm">
					เหตุผล {confirmAction === 'close' ? '(อาจเว้นว่างได้)' : '(ไม่บังคับ)'}
				</Label>
				<Input
					id="zone-action-reason"
					bind:value={confirmReason}
					placeholder={confirmAction === 'close' ? 'เช่น ห้องน้ำพัง, พื้นที่ไม่ปลอดภัย' : ''}
					autofocus
				/>
			</div>

			<Dialog.Footer class="gap-2">
				<Button variant="outline" onclick={cancelConfirm} disabled={closeZoneMutation.isPending || reopenZoneMutation.isPending}>
					ยกเลิก
				</Button>
				<Button
					variant={confirmAction === 'close' ? 'destructive' : 'default'}
					onclick={submitConfirm}
					disabled={closeZoneMutation.isPending || reopenZoneMutation.isPending}
				>
					{confirmAction === 'close' ? 'ยืนยันปิดโซน' : 'ยืนยันเปิดโซน'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</section>

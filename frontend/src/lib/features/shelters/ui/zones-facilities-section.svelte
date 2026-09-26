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
	import { ulid } from '$lib/db/ulid';
	import { useCloseZone, useReopenZone } from '../application/queries';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Power from '@lucide/svelte/icons/power';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Users from '@lucide/svelte/icons/users';
	import CapacityZoneGuideline from './capacity-zone-guideline.svelte';

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

	function syncCapacityFromZones(zoneSum: number) {
		$formData.capacity = zoneSum;
		toast.success(`ปรับความจุศูนย์เป็น ${zoneSum} คน ตามผลรวมโซนแล้ว`);
	}

	const totalToilets = $derived(
		($formData.facilities?.toilets_male ?? 0) +
			($formData.facilities?.toilets_female ?? 0) +
			($formData.facilities?.toilets_unisex ?? 0) +
			($formData.facilities?.toilets_accessible ?? 0)
	);

	const totalShowers = $derived(
		($formData.facilities?.showers_male ?? 0) +
			($formData.facilities?.showers_female ?? 0) +
			($formData.facilities?.showers_unisex ?? 0)
	);

	function syncTotalShowers() {
		const sum =
			($formData.facilities?.showers_male ?? 0) +
			($formData.facilities?.showers_female ?? 0) +
			($formData.facilities?.showers_unisex ?? 0);
		$formData.facilities.showers = sum > 0 ? sum : null;
	}

	$effect(() => {
		if (
			$formData.facilities?.showers &&
			$formData.facilities.showers > 0 &&
			$formData.facilities.showers_male == null &&
			$formData.facilities.showers_female == null &&
			$formData.facilities.showers_unisex == null
		) {
			$formData.facilities.showers_unisex = $formData.facilities.showers;
		}
	});

	const closeZoneMutation = useCloseZone();
	const reopenZoneMutation = useReopenZone();

	// Confirmation modal state for close/reopen
	let confirmAction = $state<'close' | 'reopen' | null>(null);
	let confirmZoneCode = $state<string>('');
	let confirmReason = $state<string>('');
	let confirmOpen = $derived(confirmAction !== null);
	const confirmZoneName = $derived(
		($formData.zones ?? []).find((z) => z.code === confirmZoneCode)?.name?.trim() || confirmZoneCode
	);

	function openConfirm(action: 'close' | 'reopen', zoneCode: string) {
		if (!shelterCode) {
			toast.error(
				action === 'close' ? 'บันทึกศูนย์พักพิงก่อนปิดโซน' : 'บันทึกศูนย์พักพิงก่อนเปิดโซน'
			);
			return;
		}
		confirmAction = action;
		confirmZoneCode = zoneCode;
		confirmReason = '';
	}

	function cancelConfirm() {
		confirmAction = null;
		confirmZoneCode = '';
		confirmReason = '';
	}

	function submitConfirm() {
		if (!confirmAction || !confirmZoneCode) return;
		const action = confirmAction;
		const zoneCode = confirmZoneCode;
		const reason = confirmReason.trim();
		const actor = authStore.user?.name ?? null;

		if (action === 'close') {
			closeZoneMutation.mutate(
				{
					code: shelterCode,
					zoneCode,
					zoneName: confirmZoneName,
					reason: reason || undefined,
					closedBy: actor ?? undefined
				},
				{
					onSuccess: () => {
						$formData.zones = $formData.zones.map((z) =>
							z.code === zoneCode ? { ...z, status: 'closed' as const } : z
						);
						cancelConfirm();
					},
					onError: () => cancelConfirm()
				}
			);
		} else {
			reopenZoneMutation.mutate(
				{
					code: shelterCode,
					zoneCode,
					zoneName: confirmZoneName,
					reopenedBy: actor ?? undefined
				},
				{
					onSuccess: () => {
						$formData.zones = $formData.zones.map((z) =>
							z.code === zoneCode ? { ...z, status: 'active' as const } : z
						);
						cancelConfirm();
					},
					onError: () => cancelConfirm()
				}
			);
		}
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
			newCode = `Z${ulid()}`;
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
				reopened_at: null,
				reopened_by: null,
				reason: null
			}
		];
		toast.success('เพิ่มโซนสำเร็จ');
	}

	function deleteZone(code: string) {
		$formData.zones = $formData.zones.filter((z: Zone) => z.code !== code);
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
	let newSubStorageArea = $state('');

	function addSubStorage() {
		if (!newSubStorageName.trim()) {
			toast.error('กรุณากรอกชื่อสถานที่จัดเก็บ');
			return;
		}
		const current = $formData.common_areas.sub_storage ?? [];
		// Backfill `id` on legacy items so the each-block key stays stable even
		// when an item is removed from the middle of the list.
		const withIds = current.map((item) => (item.id ? item : { ...item, id: ulid() }));
		$formData.common_areas = {
			...$formData.common_areas,
			sub_storage: [
				...withIds,
				{
					id: ulid(),
					name: newSubStorageName.trim(),
					type: newSubStorageType,
					area_m2: newSubStorageArea === '' ? null : Number(newSubStorageArea)
				}
			]
		};
		newSubStorageName = '';
		newSubStorageType = 'general';
		newSubStorageArea = '';
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
	id="zones-facilities"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
		>
			<Users class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 3</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">
				การจัดการโซนและสิ่งอำนวยความสะดวก
			</h2>
		</div>
	</div>

	<CapacityZoneGuideline
		shelterCapacity={$formData.capacity}
		zones={$formData.zones}
		{disabled}
		onSyncFromZones={syncCapacityFromZones}
	/>

	<!-- 3a. Living Zones — section shell + row borders only (≤2 card layers) -->
	<div class="flex items-center justify-between gap-3">
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
		{#each $formData.zones ?? [] as zone, index (zone.code)}
			{#snippet zoneActions(isMobile: boolean)}
				<div
					class={isMobile
						? 'flex shrink-0 items-center gap-1 md:hidden'
						: 'hidden shrink-0 items-center gap-1 md:flex'}
				>
					<Button
						variant="ghost"
						size="icon"
						class="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
						onclick={() => deleteZone(zone.code)}
						{disabled}
						title="ลบโซน"
					>
						<Trash2 class="h-4 w-4" />
					</Button>
					{#if zone.status === 'closed'}
						<Button
							variant="ghost"
							size="icon"
							class="h-9 w-9 text-green-600 hover:bg-green-50 hover:text-green-700"
							onclick={() => openConfirm('reopen', zone.code)}
							disabled={disabled || closeZoneMutation.isPending || reopenZoneMutation.isPending}
							title="เปิดโซนอีกครั้ง"
						>
							<RotateCcw class="h-4 w-4" />
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="icon"
							class="h-9 w-9 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
							onclick={() => openConfirm('close', zone.code)}
							disabled={disabled || closeZoneMutation.isPending || reopenZoneMutation.isPending}
							title="ปิดโซน"
						>
							<Power class="h-4 w-4" />
						</Button>
					{/if}
				</div>
			{/snippet}

			<div
				class="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs transition-colors sm:p-4 {zone.status ===
				'closed'
					? 'bg-slate-100/70 opacity-85'
					: ''}"
			>
				<!-- Row 1 (Mobile: Name + Actions, Desktop: Name + Type + Capacity + Actions) -->
				<div class="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
					<!-- Name and Mobile Actions -->
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<span
							class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-200/80 text-xs font-semibold text-slate-700 md:hidden"
						>
							{index + 1}
						</span>
						<Form.Field {form} name={`zones[${index}].name`} class="min-w-0 flex-1 space-y-0">
							<Form.Control>
								{#snippet children({ props })}
									<Input
										{...props}
										bind:value={zone.name}
										placeholder="ชื่อโซน"
										class="bg-white"
										{disabled}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						{#if zone.status === 'closed'}
							<span
								class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 md:hidden"
							>
								ปิด
							</span>
						{/if}

						{@render zoneActions(true)}
					</div>

					<!-- Type & Capacity (2-col grid on mobile, inline on desktop) -->
					<div class="grid grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:gap-3">
						<div class="w-full md:w-[200px]">
							<Select.Root type="single" bind:value={zone.type} {disabled}>
								<Select.Trigger
									class="flex !h-9 w-full items-start rounded-md border border-input bg-white px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
								>
									<span class="truncate">
										{zoneTypeOptions.find((o) => o.value === zone.type)?.label ?? '— เลือกประเภท —'}
									</span>
								</Select.Trigger>
								<Select.Content>
									{#each zoneTypeOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>

						<Form.Field
							{form}
							name={`zones[${index}].capacity`}
							class="w-full space-y-0 md:w-[140px]"
						>
							<Form.Control>
								{#snippet children({ props })}
									<div class="relative">
										<Input
											{...props}
											type="number"
											bind:value={zone.capacity}
											class="bg-white pr-9 text-right"
											placeholder="ความจุ"
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
					</div>

					<!-- Desktop Actions -->
					{@render zoneActions(false)}
				</div>

				<!-- Row 2: Area & Specifics -->
				<div class="grid grid-cols-1 gap-2 md:grid-cols-[160px_1fr]">
					<div class="relative">
						<Input
							type="number"
							min="0"
							step="any"
							value={zone.area_m2 ?? ''}
							oninput={(e) =>
								(zone.area_m2 =
									e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
							class="bg-white pr-12 text-right"
							placeholder="ขนาดพื้นที่"
							{disabled}
						/>
						<span class="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground"
							>ตร.ม.</span
						>
					</div>
					<Input
						value={zone.specifics ?? ''}
						oninput={(e) => (zone.specifics = e.currentTarget.value || null)}
						class="bg-white"
						placeholder="ข้อจำกัด/สิ่งอำนวยความสะดวกเฉพาะโซน (Zone Specifics)"
						{disabled}
					/>
				</div>
			</div>
		{/each}
		{#if ($formData.zones ?? []).length === 0}
			<p class="py-4 text-center text-sm text-muted-foreground">ยังไม่มีโซน กรุณาเพิ่มโซนใหม่</p>
		{/if}
	</div>

	<!-- 3b. WASH Facilities -->
	<div class="space-y-4">
		<div>
			<h3 class="text-sm font-bold text-card-foreground">
				ข้อมูลห้องน้ำและสุขอนามัย (WASH Facilities)
			</h3>
			<p class="text-xs text-muted-foreground">
				กำหนดจำนวนห้องน้ำ ห้องอาบน้ำ และสิ่งอำนวยความสะดวกด้านสุขอนามัย
			</p>
		</div>

		<!-- Group 1: ห้องน้ำ / ส้วม (Toilets) -->
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			<div
				class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5"
			>
				<div class="flex items-center gap-2">
					<span class="text-base">🚽</span>
					<span class="text-sm font-semibold text-slate-800">ห้องส้วม / ห้องน้ำ</span>
				</div>
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700"
				>
					<span>รวมห้องน้ำทั้งหมด:</span>
					<span class="font-bold tabular-nums">{totalToilets}</span>
					<span>ห้อง</span>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Form.Field {form} name="facilities.toilets_male">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700">🚹 ห้องน้ำชาย</Form.Label>
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
									class="rounded-r-none bg-white pr-2 text-right"
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
							<Form.Label class="text-xs font-medium text-slate-700">🚺 ห้องน้ำหญิง</Form.Label>
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
									class="rounded-r-none bg-white pr-2 text-right"
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

				<Form.Field {form} name="facilities.toilets_unisex">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700"
								>🚻 ห้องน้ำรวม (Unisex)</Form.Label
							>
							<div class="flex">
								<Input
									{...props}
									type="number"
									min="0"
									value={$formData.facilities.toilets_unisex ?? ''}
									oninput={(e) =>
										($formData.facilities.toilets_unisex =
											e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
									{disabled}
									placeholder="0"
									class="rounded-r-none bg-white pr-2 text-right"
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
							<Form.Label class="text-xs font-medium text-slate-700">♿ ห้องน้ำคนพิการ</Form.Label>
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
									class="rounded-r-none bg-white pr-2 text-right"
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
		</div>

		<!-- Group 2: ห้องอาบน้ำ (Showers) -->
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			<div
				class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5"
			>
				<div class="flex items-center gap-2">
					<span class="text-base">🚿</span>
					<span class="text-sm font-semibold text-slate-800">ห้องอาบน้ำ</span>
				</div>
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-teal-200/70 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700"
				>
					<span>รวมห้องอาบน้ำทั้งหมด:</span>
					<span class="font-bold tabular-nums">{totalShowers}</span>
					<span>ห้อง</span>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Form.Field {form} name="facilities.showers_male">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700">🚹 ห้องอาบน้ำชาย</Form.Label>
							<div class="flex">
								<Input
									{...props}
									type="number"
									min="0"
									value={$formData.facilities.showers_male ?? ''}
									oninput={(e) => {
										$formData.facilities.showers_male =
											e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
										syncTotalShowers();
									}}
									{disabled}
									placeholder="0"
									class="rounded-r-none bg-white pr-2 text-right"
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

				<Form.Field {form} name="facilities.showers_female">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700">🚺 ห้องอาบน้ำหญิง</Form.Label>
							<div class="flex">
								<Input
									{...props}
									type="number"
									min="0"
									value={$formData.facilities.showers_female ?? ''}
									oninput={(e) => {
										$formData.facilities.showers_female =
											e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
										syncTotalShowers();
									}}
									{disabled}
									placeholder="0"
									class="rounded-r-none bg-white pr-2 text-right"
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

				<Form.Field {form} name="facilities.showers_unisex">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700"
								>🚿 ห้องอาบน้ำรวม (Unisex)</Form.Label
							>
							<div class="flex">
								<Input
									{...props}
									type="number"
									min="0"
									value={$formData.facilities.showers_unisex ?? ''}
									oninput={(e) => {
										$formData.facilities.showers_unisex =
											e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
										syncTotalShowers();
									}}
									{disabled}
									placeholder="0"
									class="rounded-r-none bg-white pr-2 text-right"
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
		</div>

		<!-- Group 3: รถสุขาเคลื่อนที่ (Mobile Toilets) -->
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			<div class="flex items-center gap-2 border-b border-slate-200/60 pb-2.5">
				<span class="text-base">🚛</span>
				<span class="text-sm font-semibold text-slate-800">รถสุขาเคลื่อนที่</span>
			</div>

			<label class="flex cursor-pointer items-center space-x-3 text-sm">
				<Checkbox
					bind:checked={
						() => $formData.facilities.car_toilet_accessible ?? false,
						(v) => {
							$formData.facilities.car_toilet_accessible = v;
							// FR-23-7 — clear supported count when accessibility is turned off.
							if (!v) $formData.facilities.car_toilet_supported = null;
						}
					}
					{disabled}
				/>
				<span class="font-medium text-slate-700">รถสุขาเคลื่อนที่สามารถเข้าถึงพื้นที่ได้</span>
			</label>

			{#if $formData.facilities.car_toilet_accessible}
				<Form.Field {form} name="facilities.car_toilet_supported">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium text-slate-700"
								>จำนวนที่ได้รับการสนับสนุนแล้ว</Form.Label
							>
							<div class="flex max-w-xs">
								<Input
									{...props}
									type="number"
									min="0"
									value={$formData.facilities.car_toilet_supported ?? ''}
									oninput={(e) =>
										($formData.facilities.car_toilet_supported =
											e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
									{disabled}
									placeholder="0"
									class="rounded-r-none bg-white pr-2 text-right"
								/>
								<span
									class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
									>คัน</span
								>
							</div>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			{/if}
		</div>
	</div>

	<!-- 3c. Common Areas -->
	<div class="space-y-4">
		<h3 class="text-xs font-bold tracking-wider text-slate-400 uppercase">
			ข้อมูลพื้นที่ส่วนกลาง (Common Areas)
		</h3>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
			<label
				class="flex cursor-pointer items-center space-x-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-sm font-medium text-slate-800 shadow-2xs transition-colors hover:border-slate-300"
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
				class="flex cursor-pointer items-center space-x-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-sm font-medium text-slate-800 shadow-2xs transition-colors hover:border-slate-300"
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
			<label
				class="flex cursor-pointer items-center space-x-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-sm font-medium text-slate-800 shadow-2xs transition-colors hover:border-slate-300"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.isolation_room ?? false,
						(v) => ($formData.common_areas.isolation_room = v)
					}
					{disabled}
				/>
				<span>🔴 ห้องแยกกักโรค (Isolation Room)</span>
			</label>
			<label
				class="flex cursor-pointer items-center space-x-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-sm font-medium text-slate-800 shadow-2xs transition-colors hover:border-slate-300"
			>
				<Checkbox
					bind:checked={
						() => $formData.common_areas.women_child_friendly_space ?? false,
						(v) => ($formData.common_areas.women_child_friendly_space = v)
					}
					{disabled}
				/>
				<span>🧸 พื้นที่สำหรับเด็ก/สตรี (Women &amp; Child Friendly Space)</span>
			</label>
		</div>

		<div>
			<div class="mb-1.5 block text-xs font-bold tracking-wider text-slate-500 uppercase">
				📦 คลังย่อยและสถานที่จัดเก็บ
			</div>
			{#if ($formData.common_areas.sub_storage ?? []).length > 0}
				<div class="mb-2 space-y-1.5">
					{#each $formData.common_areas.sub_storage ?? [] as item, i (item.id ?? `legacy-${i}`)}
						<div
							class="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-sm shadow-2xs"
						>
							<div class="flex items-center gap-2">
								<span class="font-medium">{item.name}</span>
								<span class="text-xs text-muted-foreground">
									({subStorageOptions.find((o) => o.value === item.type)?.label ??
										item.type}{item.area_m2 ? ` · ${item.area_m2} ตร.ม.` : ''})
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
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input
					bind:value={newSubStorageName}
					{disabled}
					placeholder="ชื่อสถานที่จัดเก็บ (เช่น สนามปิงปอง: เก็บอาหารแห้ง)"
					class="flex-1 bg-white"
				/>
				<div class="flex items-center gap-2">
					<Input
						type="number"
						min="0"
						step="any"
						bind:value={newSubStorageArea}
						{disabled}
						placeholder="ตร.ม."
						class="w-20 bg-white sm:w-[100px]"
					/>
					<div class="flex-1 sm:w-[180px] sm:flex-none">
						<Select.Root type="single" bind:value={newSubStorageType} {disabled}>
							<Select.Trigger
								class="flex !h-9 w-full items-start rounded-md border border-input bg-white px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
							>
								<span class="truncate">
									{subStorageOptions.find((o) => o.value === newSubStorageType)?.label ??
										'— เลือก —'}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each subStorageOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<Button type="button" size="sm" onclick={addSubStorage} {disabled} class="shrink-0">
						<Plus class="h-3.5 w-3.5" />
						เพิ่ม
					</Button>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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

			<Form.Field {form} name="common_areas.logistics_area_m2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>📦 พื้นที่จัดการโลจิสติกส์รวม (Drop-off &amp; Sorting)</Form.Label>
						<div class="flex">
							<Input
								{...props}
								type="number"
								min="0"
								step="any"
								value={$formData.common_areas.logistics_area_m2 ?? ''}
								oninput={(e) =>
									($formData.common_areas.logistics_area_m2 =
										e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
								{disabled}
								placeholder="0"
								class="rounded-r-none"
							/>
							<span
								class="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground"
								>ตร.ม.</span
							>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>
	</div>

	<Dialog.Root open={confirmOpen} onOpenChange={(open) => !open && cancelConfirm()}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>
					{confirmAction === 'close'
						? `ปิดโซน ${confirmZoneName}`
						: `เปิดโซน ${confirmZoneName} อีกครั้ง`}
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
				<Button
					variant="outline"
					onclick={cancelConfirm}
					disabled={closeZoneMutation.isPending || reopenZoneMutation.isPending}
				>
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

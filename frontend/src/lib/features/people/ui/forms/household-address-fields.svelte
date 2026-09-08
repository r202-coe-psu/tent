<script lang="ts">
	import MapPinX from '@lucide/svelte/icons/map-pin-x';
	import LocateFixed from '@lucide/svelte/icons/locate-fixed';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { useMasterData } from '$lib/features/master-data';
	import { useDistricts, useProvinces, useSubdistricts } from '$lib/features/shelters';
	import { resolveCurrentThaiLocation } from '$lib/utils/nominatim';

	let {
		housing_type = $bindable('owned_house'),
		residence_landmark = $bindable(''),
		address_no = $bindable(''),
		village_no = $bindable(''),
		subdistrict = $bindable(''),
		district = $bindable(''),
		province = $bindable(''),
		postal_code = $bindable(''),
		disabled = false,
		required = false,
		errors
	}: {
		housing_type?: string | null;
		residence_landmark?: string;
		address_no?: string;
		village_no?: string;
		subdistrict?: string;
		district?: string;
		province?: string;
		postal_code?: string;
		disabled?: boolean;
		required?: boolean;
		errors?: {
			housing_type?: string;
			residence_landmark?: string;
			address_no?: string;
			village_no?: string;
			subdistrict?: string;
			district?: string;
			province?: string;
			postal_code?: string;
		};
	} = $props();

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const fallbackQueryResult = { data: undefined, isLoading: false, isError: false };

	const housingTypeQuery = safeQuery(
		() => useMasterData(() => 'housing_type'),
		fallbackQueryResult as unknown as ReturnType<typeof useMasterData>
	);
	const provincesQuery = safeQuery(
		() => useProvinces(),
		fallbackQueryResult as unknown as ReturnType<typeof useProvinces>
	);
	const districtsQuery = safeQuery(
		() => useDistricts(() => province || null),
		fallbackQueryResult as unknown as ReturnType<typeof useDistricts>
	);
	const subdistrictsQuery = safeQuery(
		() =>
			useSubdistricts(
				() => province || null,
				() => district || null
			),
		fallbackQueryResult as unknown as ReturnType<typeof useSubdistricts>
	);

	const DEFAULT_HOUSING_TYPES: { value: string; label: string }[] = [
		{ value: 'owned_house', label: 'บ้านตนเอง' },
		{ value: 'rented_house', label: 'บ้านเช่า' },
		{ value: 'condo', label: 'คอนโด' },
		{ value: 'apartment_dorm', label: 'อพาร์ตเมนต์ / หอพัก' },
		{ value: 'homeless', label: 'ไร้ที่อยู่อาศัยเป็นหลักแหล่ง' }
	];

	const housingTypeItems = $derived.by(() => {
		const masterItems = (housingTypeQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }));
		return masterItems.length > 0 ? masterItems : DEFAULT_HOUSING_TYPES;
	});

	const provinceItems = $derived(
		(provincesQuery.data ?? []).map((value) => ({ value, label: value }))
	);
	const districtItems = $derived(
		(districtsQuery.data ?? []).map((value) => ({ value, label: value }))
	);
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((entry) => ({
			value: entry.subdistrict,
			label: entry.subdistrict
		}))
	);

	const isHomeless = $derived(housing_type === 'homeless');
	const isApartmentDorm = $derived(housing_type === 'apartment_dorm');
	const isCondo = $derived(housing_type === 'condo');

	const addressNoLabel = $derived(
		isApartmentDorm ? 'เลขห้อง / ห้องเลขที่' : isCondo ? 'เลขห้อง / บ้านเลขที่' : 'บ้านเลขที่'
	);
	const addressNoPlaceholder = $derived(
		isApartmentDorm
			? 'เช่น ห้อง 402 หรือ อาคาร B ชั้น 3'
			: isCondo
				? 'เช่น 123/45 ห้อง 402'
				: 'เช่น 123/45'
	);
	const landmarkLabel = $derived(
		isApartmentDorm
			? 'ชื่อหอพัก / อพาร์ตเมนต์ หรือจุดสังเกต'
			: isCondo
				? 'ชื่อคอนโด / อาคาร หรือจุดสังเกต'
				: 'จุดสังเกตที่อยู่'
	);
	const landmarkPlaceholder = $derived(
		isHomeless
			? 'เช่น ริมคลองข้างตลาด'
			: isApartmentDorm
				? 'เช่น หอพักสุขใจ หรือ อาคาร C'
				: isCondo
					? 'เช่น คอนโด A ซอยสุขุมวิท 21'
					: 'เช่น ใกล้สะพาน / ปากซอย'
	);

	const addressRequired = $derived(required && !isHomeless);
	const hasLocation = $derived(Boolean(province || district || subdistrict || postal_code));

	let isLocating = $state(false);

	const selectTriggerClass =
		"flex !h-9 w-full items-start rounded-md border border-input bg-white px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground dark:bg-input/30 [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4";

	// Hide + clear house number when homeless (#249 Q5) — field must not linger in form state.
	$effect(() => {
		if (housing_type === 'homeless' && address_no) {
			address_no = '';
		}
	});

	$effect(() => {
		const sd = subdistrict;
		if (!sd) return;
		const data = subdistrictsQuery.data;
		if (!data) return;
		for (const entry of data) {
			if (entry.subdistrict === sd) {
				postal_code = `${entry.zipcode}`;
				return;
			}
		}
	});

	function selectProvince(value: string) {
		province = value;
		district = '';
		subdistrict = '';
		postal_code = '';
	}

	function selectDistrict(value: string) {
		district = value;
		subdistrict = '';
		postal_code = '';
	}

	function selectSubdistrict(value: string) {
		subdistrict = value;
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		postal_code = match ? `${match.zipcode}` : '';
	}

	function clearLocation() {
		if (disabled) return;
		province = '';
		district = '';
		subdistrict = '';
		postal_code = '';
	}

	async function handleGetCurrentLocation() {
		if (disabled || isLocating) return;
		isLocating = true;
		try {
			const loc = await resolveCurrentThaiLocation();
			if (!loc.province) {
				toast.error('ไม่สามารถระบุจังหวัดจากพิกัดปัจจุบันได้');
				return;
			}

			province = loc.province;
			district = loc.district ?? '';
			subdistrict = loc.subdistrict ?? '';
			if (loc.postal_code) {
				postal_code = loc.postal_code;
			}
			if (loc.road && !village_no) {
				village_no = loc.road;
			}

			const parts = [
				loc.subdistrict ? `ต.${loc.subdistrict}` : '',
				loc.district ? `อ.${loc.district}` : '',
				loc.province ? `จ.${loc.province}` : ''
			]
				.filter(Boolean)
				.join(' ');

			toast.success('ระบุตำแหน่งปัจจุบันเรียบร้อยแล้ว', {
				description: parts || loc.display_name
			});
		} catch (err: unknown) {
			const reason =
				err && typeof err === 'object' && 'reason' in err
					? (err as { reason?: string }).reason
					: undefined;
			const message = err instanceof Error ? err.message : undefined;
			const msg =
				reason === 'denied'
					? 'กรุณาอนุญาตการเข้าถึงตำแหน่งที่ตั้ง (Location) ในเบราว์เซอร์'
					: message || 'ไม่สามารถระบุตำแหน่งปัจจุบันได้';
			toast.error(msg);
		} finally {
			isLocating = false;
		}
	}
</script>

<div class="space-y-4">
	<!-- Housing type + landmark -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for="housing-type" class="text-xs font-semibold text-foreground">
				ประเภทที่อยู่อาศัย
			</Label>
			<Select.Root
				type="single"
				bind:value={() => housing_type ?? '', (v) => (housing_type = v || null)}
				{disabled}
			>
				<Select.Trigger id="housing-type" class={selectTriggerClass}>
					{housingTypeItems.find((o) => o.value === housing_type)?.label ??
						'— เลือกประเภทที่อยู่อาศัย —'}
				</Select.Trigger>
				<Select.Content>
					{#each housingTypeItems as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
			{#if errors?.housing_type}
				<p class="text-2xs text-destructive">{errors.housing_type}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="residence-landmark" class="text-xs font-semibold text-foreground">
				{landmarkLabel}
				{#if isHomeless}<span class="font-normal text-muted-foreground"
						>(จำเป็นถ้าไม่มีที่ตั้งครบ)</span
					>{/if}
			</Label>
			<Input
				id="residence-landmark"
				bind:value={residence_landmark}
				{disabled}
				placeholder={landmarkPlaceholder}
				class="h-9"
			/>
			{#if errors?.residence_landmark}
				<p class="text-2xs text-destructive">{errors.residence_landmark}</p>
			{/if}
		</div>
	</div>

	<!-- Street / house details — hide address_no when homeless (#249 Q5) -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#if !isHomeless}
			<div class="space-y-1.5">
				<Label for="address-no" class="text-xs font-semibold text-foreground">
					{addressNoLabel}
					{#if addressRequired}<span class="text-destructive">*</span>{/if}
				</Label>
				<Input
					id="address-no"
					bind:value={address_no}
					{disabled}
					placeholder={addressNoPlaceholder}
					class="h-9"
				/>
				{#if errors?.address_no}
					<p class="text-2xs text-destructive">{errors.address_no}</p>
				{/if}
			</div>
		{/if}

		<div class="space-y-1.5">
			<Label for="village-no" class="text-xs font-semibold text-foreground">
				หมู่ที่ / ตรอก / ซอย / ถนน
			</Label>
			<Input
				id="village-no"
				bind:value={village_no}
				{disabled}
				placeholder="เช่น หมู่ 2 ถนนมิตรภาพ"
				class="h-9"
			/>
			{#if errors?.village_no}
				<p class="text-2xs text-destructive">{errors.village_no}</p>
			{/if}
		</div>
	</div>

	<!-- Administrative area & Postal Code -->
	<div class="space-y-3 border-t border-border/70 pt-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span class="text-xs font-semibold text-foreground"> พื้นที่และรหัสไปรษณีย์ </span>
			<div class="flex items-center gap-2">
				{#if hasLocation && !disabled}
					<button
						type="button"
						onclick={clearLocation}
						class="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
					>
						<MapPinX class="size-3" /> ล้างพื้นที่
					</button>
				{/if}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || isLocating}
					onclick={handleGetCurrentLocation}
					class="h-7 gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-primary/10"
				>
					{#if isLocating}
						<Loader2 class="size-3.5 animate-spin" />
						<span>กำลังระบุตำแหน่ง…</span>
					{:else}
						<LocateFixed class="size-3.5" />
						<span>ใช้ตำแหน่งปัจจุบัน</span>
					{/if}
				</Button>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<!-- Province -->
			<div class="space-y-1.5">
				<Label for="province" class="text-xs font-semibold text-foreground">
					จังหวัด {#if (required && !isHomeless) || hasLocation}<span class="text-destructive"
							>*</span
						>{/if}
				</Label>
				<SearchSelect
					name="province"
					bind:value={() => province, selectProvince}
					options={provinceItems}
					placeholder="เลือกจังหวัด"
					searchPlaceholder="ค้นหาจังหวัด..."
					emptyText={provincesQuery.isError ? 'โหลดจังหวัดไม่สำเร็จ' : 'ไม่พบจังหวัด'}
					loading={provincesQuery.isLoading}
					{disabled}
					class="!h-9 rounded-md text-xs"
					controlProps={{ id: 'province' }}
				/>
				{#if errors?.province}
					<p class="text-2xs text-destructive">{errors.province}</p>
				{/if}
			</div>

			<!-- District -->
			<div class="space-y-1.5">
				<Label for="district" class="text-xs font-semibold text-foreground">
					อำเภอ / เขต {#if (required && !isHomeless) || hasLocation}<span class="text-destructive"
							>*</span
						>{/if}
				</Label>
				<SearchSelect
					name="district"
					bind:value={() => district, selectDistrict}
					options={districtItems}
					placeholder={!province ? 'เลือกจังหวัดก่อน' : 'เลือกอำเภอ / เขต'}
					searchPlaceholder="ค้นหาอำเภอ / เขต..."
					emptyText={districtsQuery.isError ? 'โหลดอำเภอไม่สำเร็จ' : 'ไม่พบอำเภอ / เขต'}
					loading={districtsQuery.isLoading}
					disabled={disabled || !province}
					class="!h-9 rounded-md text-xs"
					controlProps={{ id: 'district' }}
				/>
				{#if errors?.district}
					<p class="text-2xs text-destructive">{errors.district}</p>
				{/if}
			</div>

			<!-- Subdistrict -->
			<div class="space-y-1.5">
				<Label for="subdistrict" class="text-xs font-semibold text-foreground">
					ตำบล / แขวง {#if (required && !isHomeless) || hasLocation}<span class="text-destructive"
							>*</span
						>{/if}
				</Label>
				<SearchSelect
					name="subdistrict"
					bind:value={() => subdistrict, selectSubdistrict}
					options={subdistrictItems}
					placeholder={!district ? 'เลือกอำเภอก่อน' : 'เลือกตำบล / แขวง'}
					searchPlaceholder="ค้นหาตำบล / แขวง..."
					emptyText={subdistrictsQuery.isError ? 'โหลดตำบลไม่สำเร็จ' : 'ไม่พบตำบล / แขวง'}
					loading={subdistrictsQuery.isLoading}
					disabled={disabled || !district}
					class="!h-9 rounded-md text-xs"
					controlProps={{ id: 'subdistrict' }}
				/>
				{#if errors?.subdistrict}
					<p class="text-2xs text-destructive">{errors.subdistrict}</p>
				{/if}
			</div>

			<!-- Postal code -->
			<div class="space-y-1.5">
				<Label for="postal_code" class="text-xs font-semibold text-foreground">
					รหัสไปรษณีย์ {#if (required && !isHomeless) || hasLocation}<span class="text-destructive"
							>*</span
						>{/if}
				</Label>
				<Input
					id="postal_code"
					bind:value={postal_code}
					disabled
					placeholder={!subdistrict ? 'เลือกตำบลก่อน' : 'กำลังเติมรหัสไปรษณีย์...'}
					class="h-9 bg-muted/50 text-xs"
				/>
				{#if errors?.postal_code}
					<p class="text-2xs text-destructive">{errors.postal_code}</p>
				{/if}
			</div>
		</div>
	</div>
</div>

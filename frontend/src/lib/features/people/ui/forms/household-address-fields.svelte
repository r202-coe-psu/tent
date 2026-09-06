<script lang="ts">
	import MapPinX from '@lucide/svelte/icons/map-pin-x';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { useDistricts, useProvinces, useSubdistricts } from '$lib/features/shelters';

	let {
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
		address_no?: string;
		village_no?: string;
		subdistrict?: string;
		district?: string;
		province?: string;
		postal_code?: string;
		disabled?: boolean;
		required?: boolean;
		errors?: {
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

	const hasLocation = $derived(Boolean(province || district || subdistrict || postal_code));

	$effect(() => {
		if (!subdistrict) return;
		const match = (subdistrictsQuery.data ?? []).find((entry) => entry.subdistrict === subdistrict);
		if (match) postal_code = String(match.zipcode);
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
		postal_code = match ? String(match.zipcode) : '';
	}

	function clearLocation() {
		if (disabled) return;
		province = '';
		district = '';
		subdistrict = '';
		postal_code = '';
	}
</script>

<div class="space-y-4">
	<!-- Street / house details -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for="address-no" class="text-xs font-semibold text-foreground">
				บ้านเลขที่ {#if required}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id="address-no"
				bind:value={address_no}
				{disabled}
				placeholder="เช่น 123/45"
				class="h-9"
			/>
			{#if errors?.address_no}
				<p class="text-2xs text-destructive">{errors.address_no}</p>
			{/if}
		</div>

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
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-foreground"> พื้นที่และรหัสไปรษณีย์ </span>
			{#if hasLocation && !disabled}
				<button
					type="button"
					onclick={clearLocation}
					class="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
				>
					<MapPinX class="size-3" /> ล้างพื้นที่
				</button>
			{/if}
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<!-- Province -->
			<div class="space-y-1.5">
				<Label for="province" class="text-xs font-semibold text-foreground">
					จังหวัด {#if required || hasLocation}<span class="text-destructive">*</span>{/if}
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
					อำเภอ / เขต {#if required || hasLocation}<span class="text-destructive">*</span>{/if}
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
					ตำบล / แขวง {#if required || hasLocation}<span class="text-destructive">*</span>{/if}
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
					รหัสไปรษณีย์ {#if required || hasLocation}<span class="text-destructive">*</span>{/if}
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

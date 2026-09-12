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
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

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

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

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

	function housingLabelForCode(code: string, fallback: string): string {
		switch (code) {
			case 'owned_house':
				return t.housingOwned;
			case 'rented_house':
				return t.housingRented;
			case 'condo':
				return t.housingCondo;
			case 'apartment_dorm':
				return t.housingApartment;
			case 'homeless':
				return t.housingHomeless;
			default:
				return fallback;
		}
	}

	const DEFAULT_HOUSING_TYPES = $derived([
		{ value: 'owned_house', label: t.housingOwned },
		{ value: 'rented_house', label: t.housingRented },
		{ value: 'condo', label: t.housingCondo },
		{ value: 'apartment_dorm', label: t.housingApartment },
		{ value: 'homeless', label: t.housingHomeless }
	]);

	const housingTypeItems = $derived.by(() => {
		const masterItems = (housingTypeQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: housingLabelForCode(i.code, i.label) }));
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
		isApartmentDorm ? t.addressNoApartmentLabel : isCondo ? t.addressNoCondoLabel : t.addressNoLabel
	);
	const addressNoPlaceholder = $derived(
		isApartmentDorm
			? t.addressNoApartmentPlaceholder
			: isCondo
				? t.addressNoCondoPlaceholder
				: t.addressNoPlaceholder
	);
	const landmarkLabel = $derived(
		isApartmentDorm
			? t.landmarkLabelApartment
			: isCondo
				? t.landmarkLabelCondo
				: t.landmarkLabelDefault
	);
	const landmarkPlaceholder = $derived(
		isHomeless
			? t.landmarkPlaceholderHomeless
			: isApartmentDorm
				? t.landmarkPlaceholderApartment
				: isCondo
					? t.landmarkPlaceholderCondo
					: t.landmarkPlaceholderDefault
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
				toast.error(t.locateNoProvince);
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

			toast.success(t.locateSuccess, {
				description: parts || loc.display_name
			});
		} catch (err: unknown) {
			const reason =
				err && typeof err === 'object' && 'reason' in err
					? (err as { reason?: string }).reason
					: undefined;
			const message = err instanceof Error ? err.message : undefined;
			const msg = reason === 'denied' ? t.locateDenied : message || t.locateFail;
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
				{t.housingTypeLabel}
			</Label>
			<Select.Root
				type="single"
				bind:value={() => housing_type ?? '', (v) => (housing_type = v || null)}
				{disabled}
			>
				<Select.Trigger id="housing-type" class={selectTriggerClass}>
					{housingTypeItems.find((o) => o.value === housing_type)?.label ??
						t.housingTypePlaceholder}
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
						>{t.landmarkRequiredIfNoLocation}</span
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
				{t.villageNoLabel}
			</Label>
			<Input
				id="village-no"
				bind:value={village_no}
				{disabled}
				placeholder={t.villageNoPlaceholder}
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
			<span class="text-xs font-semibold text-foreground"> {t.areaAndPostalHeading} </span>
			<div class="flex items-center gap-2">
				{#if hasLocation && !disabled}
					<button
						type="button"
						onclick={clearLocation}
						class="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
					>
						<MapPinX class="size-3" />
						{t.clearArea}
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
						<span>{t.locating}</span>
					{:else}
						<LocateFixed class="size-3.5" />
						<span>{t.useCurrentLocation}</span>
					{/if}
				</Button>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<!-- Province -->
			<div class="space-y-1.5">
				<Label for="province" class="text-xs font-semibold text-foreground">
					{t.provinceLabel}
					{#if (required && !isHomeless) || hasLocation}<span class="text-destructive">*</span>{/if}
				</Label>
				<SearchSelect
					name="province"
					bind:value={() => province, selectProvince}
					options={provinceItems}
					placeholder={t.provincePlaceholder}
					searchPlaceholder={t.provinceSearch}
					emptyText={provincesQuery.isError ? t.provinceLoadFail : t.provinceEmpty}
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
					{t.districtLabel}
					{#if (required && !isHomeless) || hasLocation}<span class="text-destructive">*</span>{/if}
				</Label>
				<SearchSelect
					name="district"
					bind:value={() => district, selectDistrict}
					options={districtItems}
					placeholder={!province ? t.districtNeedsProvince : t.districtPlaceholder}
					searchPlaceholder={t.districtSearch}
					emptyText={districtsQuery.isError ? t.districtLoadFail : t.districtEmpty}
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
					{t.subdistrictLabel}
					{#if (required && !isHomeless) || hasLocation}<span class="text-destructive">*</span>{/if}
				</Label>
				<SearchSelect
					name="subdistrict"
					bind:value={() => subdistrict, selectSubdistrict}
					options={subdistrictItems}
					placeholder={!district ? t.subdistrictNeedsDistrict : t.subdistrictPlaceholder}
					searchPlaceholder={t.subdistrictSearch}
					emptyText={subdistrictsQuery.isError ? t.subdistrictLoadFail : t.subdistrictEmpty}
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
					{t.postalCodeLabel}
					{#if (required && !isHomeless) || hasLocation}<span class="text-destructive">*</span>{/if}
				</Label>
				<Input
					id="postal_code"
					bind:value={postal_code}
					disabled
					placeholder={!subdistrict ? t.postalNeedsSubdistrict : t.postalFilling}
					class="h-9 bg-muted/50 text-xs"
				/>
				{#if errors?.postal_code}
					<p class="text-2xs text-destructive">{errors.postal_code}</p>
				{/if}
			</div>
		</div>
	</div>
</div>

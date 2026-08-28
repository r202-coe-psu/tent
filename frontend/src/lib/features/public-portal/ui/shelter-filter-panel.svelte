<script lang="ts">
	/* eslint-disable svelte/prefer-writable-derived */
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Switch } from '$lib/components/ui/switch';
	import * as Accordion from '$lib/components/ui/accordion';
	import * as Select from '$lib/components/ui/select';
	import SearchSelect from '$lib/components/search-select.svelte';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import { getAllLocations } from '$lib/features/shelters';
	import {
		geolocationBlockReason,
		GeolocationUnavailableError,
		requestUserPosition,
		type GeoUnavailableReason
	} from '../data/geolocation';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_FILTER_PANEL_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	interface Filters {
		search?: string;
		province?: string;
		district?: string;
		subdistrict?: string;
		type?: string;
		site_kind?: 'evacuation_center' | 'host_house';
		distance?: string;
		user_lat?: string | number;
		user_lng?: string | number;
		status?: string;
		hide_full?: boolean | string;
		vulnerable_bed?: boolean;
		vulnerable_wheelchair?: boolean;
		vulnerable_infant?: boolean;
		vulnerable_elderly?: boolean;
		vulnerable_isolation?: boolean;
		facility_kitchen?: boolean;
		facility_women_child?: boolean;
		pet_general?: boolean;
		pet_large?: boolean;
		pet_livestock?: boolean;
		parking_car?: boolean;
		parking_motorcycle?: boolean;
		parking_boat?: boolean;
		utility_wifi?: boolean;
		utility_high_ground?: boolean;
		utility_truck_access?: boolean;
	}

	let {
		filters = {},
		availableTypes = [],
		action = '/shelters',
		userLat = $bindable(''),
		userLng = $bindable('')
	}: {
		filters?: Filters;
		availableTypes?: string[];
		action?: string;
		userLat?: string;
		userLng?: string;
	} = $props();

	const DISTANCE_PRESETS = ['1', '2', '4', '5', '10'] as const;

	let searchQuery = $state<string>('');
	let selectedProvince = $state<string>('');
	let selectedDistrict = $state<string>('');
	let selectedSubdistrict = $state<string>('');
	let selectedSiteKind = $state<string>('');
	let distanceValue = $state<string>('5');
	/** Draft for the custom km field (may differ from distanceValue while typing). */
	let customDistanceDraft = $state<string>('');
	let customDistanceError = $state(false);

	const t = $derived(getTranslation(PUBLIC_FILTER_PANEL_I18N, langState.current));

	function isDistancePreset(value: string): boolean {
		return (DISTANCE_PRESETS as readonly string[]).includes(value);
	}

	function normalizeDistanceKm(raw: string): string | null {
		const trimmed = raw.trim().replace(',', '.');
		if (!trimmed) return null;
		const n = Number(trimmed);
		if (!Number.isFinite(n) || n <= 0) return null;
		// Trim excess float noise (e.g. 3.000 → 3).
		const rounded = Math.round(n * 1000) / 1000;
		return String(rounded);
	}

	$effect(() => {
		searchQuery = filters.search ?? '';
		selectedProvince = filters.province ?? '';
		selectedDistrict = filters.district ?? '';
		selectedSubdistrict = filters.subdistrict ?? '';
		selectedSiteKind = filters.site_kind ?? '';
		const nextDistance = filters.distance || '5';
		distanceValue = nextDistance;
		customDistanceDraft = isDistancePreset(nextDistance) ? '' : nextDistance;
		customDistanceError = false;

		if (filters.user_lat) userLat = filters.user_lat.toString();
		if (filters.user_lng) userLng = filters.user_lng.toString();
	});

	let isCustomDistance = $derived(distanceValue !== '' && !isDistancePreset(distanceValue));

	let locationData = $state<{ province: string; district: string; subdistrict: string }[]>([]);

	let provincesList = $derived([
		{ label: t.provincePlaceholder, value: '' },
		...[...new Set((locationData || []).map((d) => d.province))]
			.sort()
			.map((p) => ({ label: p, value: p }))
	]);

	let districtsList = $derived([
		{ label: t.districtPlaceholder, value: '' },
		...[
			...new Set(
				(locationData || [])
					.filter((d) => !selectedProvince || d.province === selectedProvince)
					.map((d) => d.district)
			)
		]
			.sort()
			.map((d) => ({ label: d, value: d }))
	]);

	let subdistrictsList = $derived([
		{ label: t.subdistrictPlaceholder, value: '' },
		...[
			...new Set(
				(locationData || [])
					.filter(
						(d) =>
							(!selectedProvince || d.province === selectedProvince) &&
							(!selectedDistrict || d.district === selectedDistrict)
					)
					.map((d) => d.subdistrict)
			)
		]
			.sort()
			.map((d) => ({ label: d, value: d }))
	]);

	let locating = $state(false);
	let geoReason = $state<GeoUnavailableReason | null>(null);
	let hasPosition = $derived(Boolean(userLat && userLng));
	let distanceLocked = $derived(!hasPosition && (locating || geoReason !== null));

	// Map pin (or GPS) sets bindable lat/lng — clear GPS error so radius stays usable.
	$effect(() => {
		if (userLat && userLng) geoReason = null;
	});

	let geoHint = $derived.by(() => {
		if (hasPosition) return '';
		switch (geoReason) {
			case 'insecure':
				return t.geoInsecure;
			case 'policy':
				return t.geoPolicy;
			case 'denied':
				return t.geoDenied;
			case 'unsupported':
			case 'unavailable':
				return t.geoUnsupported;
			default:
				return locating ? t.geoLocating : t.geoPinHint;
		}
	});

	async function ensureUserPosition(): Promise<boolean> {
		if (hasPosition) return true;

		const blocked = geolocationBlockReason();
		if (blocked) {
			geoReason = blocked;
			return false;
		}

		locating = true;
		try {
			const pos = await requestUserPosition();
			userLat = pos.lat;
			userLng = pos.lng;
			geoReason = null;
			return true;
		} catch (err) {
			geoReason = err instanceof GeolocationUnavailableError ? err.reason : 'unavailable';
			return false;
		} finally {
			locating = false;
		}
	}

	onMount(async () => {
		const locationsPromise = getAllLocations()
			.then((data) => {
				locationData = data;
			})
			.catch(() => {
				/* province/district selects stay empty */
			});

		// First visit: request GPS so the map can show the user marker without a distance click.
		await ensureUserPosition();
		await locationsPromise;
	});

	async function selectDistance(km: string) {
		if (distanceValue === km) {
			distanceValue = '';
			customDistanceDraft = '';
			customDistanceError = false;
			return;
		}
		if (!(await ensureUserPosition())) return;
		distanceValue = km;
		customDistanceDraft = '';
		customDistanceError = false;
	}

	async function applyCustomDistance() {
		const normalized = normalizeDistanceKm(customDistanceDraft);
		if (normalized === null) {
			if (customDistanceDraft.trim() === '') {
				customDistanceError = false;
				if (isCustomDistance) distanceValue = '';
				return;
			}
			customDistanceError = true;
			return;
		}
		if (!(await ensureUserPosition())) return;
		customDistanceError = false;
		customDistanceDraft = normalized;
		distanceValue = normalized;
	}

	async function onCustomDistanceFocus() {
		customDistanceError = false;
		if (!hasPosition) await ensureUserPosition();
	}

	/** Sync custom draft into distance before GET submit (covers submit without blur). */
	function prepareDistanceForSubmit(): boolean {
		const draft = customDistanceDraft.trim();
		if (!draft) {
			customDistanceError = false;
			return true;
		}
		const normalized = normalizeDistanceKm(draft);
		if (normalized === null) {
			customDistanceError = true;
			return false;
		}
		customDistanceError = false;
		customDistanceDraft = normalized;
		distanceValue = normalized;
		return true;
	}

	function translateAdminType(type: string): string {
		if (langState.current !== 'en') return type;
		const map: Record<string, string> = {
			วัด: 'Temple',
			โรงเรียน: 'School',
			ศาลาประชาคม: 'Community Hall',
			ศูนย์กีฬา: 'Sports Centre',
			อาคารราชการ: 'Government Building',
			หน่วยงานราชการ: 'Government Agency',
			ศูนย์อพยพ: 'Evacuation Center',
			มหาวิทยาลัย: 'University',
			มัสยิด: 'Mosque',
			โบสถ์: 'Church',
			พื้นที่เอกชน: 'Private Area',
			อื่นๆ: 'Other',
			unspecified: 'Unspecified'
		};
		return map[type] || type;
	}

	let hideFullToggle = $state<boolean>(false);
	$effect(() => {
		hideFullToggle = filters.hide_full === true || filters.hide_full === 'true';
	});
</script>

<div
	class="flex h-[85vh] max-h-200 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
>
	<div class="mb-4 flex shrink-0 items-center gap-2">
		<Filter class="h-4 w-4 text-primary" />
		<h3 class="font-bold text-foreground">{t.title}</h3>
	</div>

	<form
		method="GET"
		{action}
		class="flex min-h-0 flex-1 flex-col"
		onsubmit={(e) => {
			if (!prepareDistanceForSubmit()) e.preventDefault();
		}}
	>
		<div class="custom-scrollbar -mr-3 flex-1 overflow-x-hidden overflow-y-auto pr-3">
			<div class="space-y-4">
				<!-- Search -->
				<div class="space-y-1.5">
					<Label for="search" class="text-xs font-semibold text-muted-foreground"
						>{t.searchLabel}</Label
					>
					<div class="relative">
						<Input
							id="search"
							name="q"
							type="text"
							bind:value={searchQuery}
							placeholder={t.searchPlaceholder}
							class="w-full rounded-xl pl-9"
						/>
						<Search class="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
					</div>
				</div>
				<!-- Province -->
				<div class="w-full space-y-1.5">
					<Label for="province" class="text-xs font-semibold text-muted-foreground"
						>{t.provinceLabel}</Label
					>
					<SearchSelect
						name="province"
						placeholder={t.provincePlaceholder}
						bind:value={selectedProvince}
						options={provincesList}
					/>
				</div>

				<!-- District -->
				<div class="w-full space-y-1.5">
					<Label for="district" class="text-xs font-semibold text-muted-foreground"
						>{t.districtLabel}</Label
					>
					<SearchSelect
						name="district"
						placeholder={t.districtPlaceholder}
						bind:value={selectedDistrict}
						options={districtsList}
					/>
				</div>

				<!-- Sub-district -->
				<div class="w-full space-y-1.5">
					<Label for="subdistrict" class="text-xs font-semibold text-muted-foreground"
						>{t.subdistrictLabel}</Label
					>
					<SearchSelect
						name="subdistrict"
						placeholder={t.subdistrictPlaceholder}
						bind:value={selectedSubdistrict}
						options={subdistrictsList}
					/>
				</div>

				<!-- Site kind -->
				<div class="space-y-1.5">
					<Label for="site_kind" class="text-xs font-semibold text-muted-foreground"
						>{t.siteKindLabel}</Label
					>
					<Select.Root type="single" name="site_kind" bind:value={selectedSiteKind}>
						<Select.Trigger class="w-full rounded-xl">
							<Select.Value placeholder={t.siteKindPlaceholder} />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">{t.siteKindAll}</Select.Item>
							<Select.Item value="evacuation_center">{t.siteKindEvacCenter}</Select.Item>
							<Select.Item value="host_house">{t.siteKindHostHouse}</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Building type -->
				<div class="space-y-1.5">
					<Label for="type" class="text-xs font-semibold text-muted-foreground">{t.typeLabel}</Label
					>
					<Select.Root type="single" name="type" value={filters.type ?? ''}>
						<Select.Trigger class="w-full rounded-xl">
							<Select.Value placeholder={t.typePlaceholder} />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">{t.typePlaceholder}</Select.Item>
							{#each availableTypes as tp (tp)}
								<Select.Item value={tp}>{translateAdminType(tp)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Distance presets + custom km -->
				<div class="space-y-3">
					<div class="text-xs font-bold text-foreground">{t.radiusLabel}</div>
					<div
						class="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/20 p-1"
						title={geoHint || undefined}
					>
						<input type="hidden" name="distance" value={hasPosition ? distanceValue : ''} />
						{#each DISTANCE_PRESETS as km (km)}
							<button
								type="button"
								disabled={distanceLocked}
								class="min-w-[3.25rem] flex-1 rounded-md px-1 py-1.5 text-center text-[12px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 {distanceValue ===
								km
									? 'bg-primary-dark font-bold text-white'
									: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
								onclick={() => selectDistance(km)}
							>
								{km}
								{t.km}
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2" title={geoHint || undefined}>
						<span
							class="shrink-0 text-[12px] font-medium {isCustomDistance
								? 'font-bold text-foreground'
								: 'text-muted-foreground'}">{t.radiusCustom}</span
						>
						<Input
							type="text"
							inputmode="decimal"
							disabled={distanceLocked}
							bind:value={customDistanceDraft}
							placeholder={t.radiusCustomPlaceholder}
							aria-invalid={customDistanceError}
							aria-label={t.radiusCustom}
							class="h-8 w-full rounded-md text-[13px] {isCustomDistance
								? 'border-primary-dark/40'
								: ''} {customDistanceError ? 'border-destructive' : ''}"
							onfocus={() => onCustomDistanceFocus()}
							onblur={() => applyCustomDistance()}
							onchange={() => applyCustomDistance()}
						/>
						<span class="shrink-0 text-[12px] text-muted-foreground">{t.km}</span>
					</div>
					{#if customDistanceError}
						<p class="text-[11px] text-destructive">{t.radiusInvalid}</p>
					{/if}
					{#if geoHint}
						<p class="text-[11px] text-muted-foreground">{geoHint}</p>
					{/if}
				</div>

				<!-- Hidden geolocation inputs -->
				<input type="hidden" name="user_lat" id="user_lat" value={userLat} />
				<input type="hidden" name="user_lng" id="user_lng" value={userLng} />

				<!-- Capacity Switch Card -->
				<div class="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
					<Switch bind:checked={hideFullToggle} class="mt-1" />
					<input
						type="checkbox"
						name="hide_full"
						value="true"
						class="hidden"
						checked={hideFullToggle}
					/>
					<div class="flex flex-col gap-1">
						<Label
							for="hide_full_ui"
							class="cursor-pointer text-sm leading-tight font-bold text-foreground"
							>{t.hideFullTitle}</Label
						>
						<span class="text-[11px] text-muted-foreground">{t.hideFullDesc}</span>
					</div>
				</div>

				<!-- Advanced Filters -->
				<div class="overflow-hidden rounded-xl border border-border">
					<Accordion.Root type="single" class="w-full">
						<Accordion.Item value="advanced-filters" class="border-none">
							<Accordion.Trigger
								class="px-4 py-3 transition-colors hover:bg-muted/50 hover:no-underline"
							>
								<span class="text-sm font-bold text-primary-dark">{t.advancedFilters}</span>
							</Accordion.Trigger>
							<Accordion.Content class="pb-2">
								<div class="space-y-6 px-2 pt-2 pb-2">
									<!-- Category 1 -->
									<div class="space-y-3 rounded-lg bg-muted/50 p-4">
										<div class="text-[13px] font-bold text-foreground">{t.cat1}</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_bed"
													checked={filters.vulnerable_bed === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.vulBed}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_wheelchair"
													checked={filters.vulnerable_wheelchair === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.vulWheelchair}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_infant"
													checked={filters.vulnerable_infant === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.vulInfant}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_elderly"
													checked={filters.vulnerable_elderly === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.vulElderly}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_isolation"
													checked={filters.vulnerable_isolation === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.vulIsolation}</span
												>
											</label>
										</div>
									</div>
									<!-- Category 2 -->
									<div class="space-y-3 rounded-lg bg-muted/50 p-4">
										<div class="text-[13px] font-bold text-foreground">{t.cat2}</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="pet_general"
													checked={filters.pet_general === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.petGen}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="pet_large"
													checked={filters.pet_large === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.petLarge}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="pet_livestock"
													checked={filters.pet_livestock === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.petLive}</span
												>
											</label>
										</div>
									</div>
									<!-- Category 3 -->
									<div class="space-y-3 rounded-lg bg-muted/50 p-4">
										<div class="text-[13px] font-bold text-foreground">{t.cat3}</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="parking_car"
													checked={filters.parking_car === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.parkCar}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="parking_motorcycle"
													checked={filters.parking_motorcycle === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.parkMotor}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="parking_boat"
													checked={filters.parking_boat === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.parkBoat}</span
												>
											</label>
										</div>
									</div>
									<!-- Category 4 -->
									<div class="space-y-3 rounded-lg bg-muted/50 p-4">
										<div class="text-[13px] font-bold text-foreground">
											{t.cat4}
										</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="utility_wifi"
													checked={filters.utility_wifi === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.utilWifi}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="facility_kitchen"
													checked={filters.facility_kitchen === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.facKitchen}</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="facility_women_child"
													checked={filters.facility_women_child === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>{t.facWomen}</span
												>
											</label>
										</div>
									</div>
								</div>
							</Accordion.Content>
						</Accordion.Item>
					</Accordion.Root>
				</div>
			</div>
		</div>

		<!-- Submit -->
		<div class="flex shrink-0 gap-2 border-t border-border pt-4">
			<Button
				variant="outline"
				href={action}
				size="lg"
				class="w-1/3 rounded-xl font-bold text-muted-foreground shadow-sm hover:bg-muted"
			>
				{t.clearBtn}
			</Button>
			<Button type="submit" size="lg" class="w-2/3 rounded-xl font-bold shadow-sm">
				{t.submitBtn}
			</Button>
		</div>
	</form>
</div>

<style>
	/* Custom scrollbar for the filter panel */
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background-color: #cbd5e1;
		border-radius: 10px;
	}
	.custom-scrollbar:hover::-webkit-scrollbar-thumb {
		background-color: #94a3b8;
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import {
		type LocationRow,
		useProvinces,
		useDistricts,
		useSubdistricts
	} from '$lib/features/locations';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import CheckSquare from '@lucide/svelte/icons/check-square';
	import Check from '@lucide/svelte/icons/check';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { toast } from 'svelte-sonner';

	import SearchSelect from '$lib/components/search-select.svelte';
	import { getAllLocations } from '$lib/features/shelters/data/thailand-location.api';
	import { getTranslation } from '$lib/utils/i18n';

	import { languageStore } from '$lib/stores/language.svelte';
	import { HOUSEHOLD_REGISTER_I18N } from './_constants/household-register.i18n';

	let {
		allEvacuees = [],
		households = [],
		initialAddress = null,
		onsubmit,
		onselect,
		pending = false,
		showNewHouseholdForm = $bindable(false)
	}: {
		allEvacuees?: Evacuee[];
		households?: Household[];
		initialAddress?: Partial<HouseholdInput> | null;
		onsubmit?: (input: Partial<HouseholdInput>) => void;
		onselect?: (household: Household) => void;
		pending?: boolean;
		showNewHouseholdForm?: boolean;
	} = $props();

	const t = $derived(getTranslation(HOUSEHOLD_REGISTER_I18N, languageStore.current));

	let searchMode: 'exact' | 'fuzzy' = $state('fuzzy');
	let searchQuery = $state('');
	let searchAddressNo = $state('');

	let selectedLocationValue = $state('');
	let selectedLocation = $state<LocationRow | null>(null);
	let locationItems = $state.raw<{ value: string; label: string }[]>([]);
	let locationsLoading = $state(true);
	let locationsError = $state<string | null>(null);

	onMount(async () => {
		try {
			const data = await getAllLocations();
			locationItems = data.map((item) => {
				const label = `ต.${item.subdistrict} อ.${item.district} จ.${item.province} ${item.zipcode}`;
				return {
					value: JSON.stringify(item),
					label
				};
			});
			locationsError = null;
		} catch {
			locationsError = t.addressSearch.errorLoading;
			toast.error(t.addressSearch.toastError);
		} finally {
			locationsLoading = false;
		}
	});

	async function retryLocations() {
		locationsLoading = true;
		locationsError = null;
		try {
			const data = await getAllLocations();
			locationItems = data.map((item) => {
				const label = `ต.${item.subdistrict} อ.${item.district} จ.${item.province} ${item.zipcode}`;
				return {
					value: JSON.stringify(item),
					label
				};
			});
		} catch {
			locationsError = t.addressSearch.errorLoading;
			toast.error(t.addressSearch.toastError);
		} finally {
			locationsLoading = false;
		}
	}

	$effect(() => {
		if (selectedLocationValue) {
			try {
				selectedLocation = JSON.parse(selectedLocationValue);
			} catch {
				selectedLocation = null;
			}
		} else {
			selectedLocation = null;
		}
	});

	let searchState: 'idle' | 'found' | 'not_found' = $state('idle');

	let foundResults = $state<
		{
			household: Household;
			evacuee: Evacuee | null;
			count: number;
			members: Evacuee[];
			expanded: boolean;
		}[]
	>([]);

	let selectedHouseholdId = $state<string | null>(null);
	let selectedResult = $derived(foundResults.find((r) => r.household._id === selectedHouseholdId));

	let formData = $state({
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	});

	const provincesQuery = useProvinces();

	const districtsQuery = useDistricts(() => formData.province || null);
	const subdistrictsQuery = useSubdistricts(
		() => formData.province || null,
		() => formData.district || null
	);

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

	function selectProvince(value: string | null) {
		formData.province = value ?? '';
		// Downstream choices no longer apply to the new province.
		formData.district = '';
		formData.subdistrict = '';
		formData.postal_code = '';
	}

	function selectDistrict(value: string | null) {
		formData.district = value ?? '';
		formData.subdistrict = '';
		formData.postal_code = '';
	}

	function selectSubdistrict(value: string | null) {
		formData.subdistrict = value ?? '';
		const match = (subdistrictsQuery.data ?? []).find((s) => s.subdistrict === value);
		formData.postal_code = match ? String(match.zipcode) : '';
	}

	$effect(() => {
		if (initialAddress && (initialAddress.province || initialAddress.address_no)) {
			if (initialAddress.address_no) formData.address_no = initialAddress.address_no;
			if (initialAddress.village_no) formData.village_no = initialAddress.village_no;
			if (initialAddress.province) formData.province = initialAddress.province;
			if (initialAddress.district) formData.district = initialAddress.district;
			if (initialAddress.subdistrict) formData.subdistrict = initialAddress.subdistrict;
			if (initialAddress.postal_code) formData.postal_code = initialAddress.postal_code;
			showNewHouseholdForm = true;
		}
	});

	$effect(() => {
		if (formData.subdistrict && !formData.postal_code && subdistrictsQuery.data?.length) {
			const match = subdistrictsQuery.data.find((s) => s.subdistrict === formData.subdistrict);
			if (match) {
				formData.postal_code = String(match.zipcode);
			}
		}
	});

	$effect(() => {
		if (showNewHouseholdForm && selectedLocation) {
			formData.province = selectedLocation.province;
			formData.district = selectedLocation.district;
			formData.subdistrict = selectedLocation.subdistrict;
			formData.postal_code = String(selectedLocation.zipcode);
		}
	});

	function formatAddress(h: Household) {
		const parts = [];
		if (h.address_no) parts.push(h.address_no);
		else parts.push('-');

		if (h.village_no) {
			const v = h.village_no.replace(/^(ม\.|หมู่\s*)/, '');
			parts.push(`ม.${v}`);
		}
		if (h.subdistrict) {
			const s = h.subdistrict.replace(/^(ต\.|ตำบล\s*)/, '');
			parts.push(`ต.${s}`);
		}
		if (h.district) {
			const d = h.district.replace(/^(อ\.|อำเภอ\s*)/, '');
			parts.push(`อ.${d}`);
		}
		if (h.province) {
			const p = h.province.replace(/^(จ\.|จังหวัด\s*)/, '');
			parts.push(`จ.${p}`);
		}
		if (h.postal_code) parts.push(h.postal_code);

		return parts.join(' ');
	}

	function doSearch() {
		if (searchMode === 'exact') {
			if (!searchQuery.trim()) {
				searchState = 'idle';
				return;
			}
			const query = searchQuery.trim().toLowerCase();
			const hhList = households.filter((h) => {
				if (!h.head_evacuee_id) return false;
				const head = allEvacuees.find(
					(e) => e._id === h.head_evacuee_id && !e.privacy?.search_excluded
				);
				if (!head) return false;
				return (
					(head.phone && head.phone.toLowerCase().includes(query)) ||
					(head.person_id?.number && head.person_id.number.toLowerCase().includes(query))
				);
			});
			if (hhList.length > 0) {
				foundResults = hhList.map((hh) => {
					const members = allEvacuees.filter((e) => e.household_id === hh._id);
					return {
						household: hh,
						evacuee: allEvacuees.find((e) => e._id === hh.head_evacuee_id) || null,
						count: members.length,
						members,
						expanded: false
					};
				});
				searchState = 'found';
				showNewHouseholdForm = false;
				return;
			}
		} else {
			const addressNoQuery = searchAddressNo.trim().toLowerCase();

			if (!addressNoQuery && !selectedLocation) {
				searchState = 'idle';
				return;
			}

			const hhList = households.filter((h) => {
				if (addressNoQuery) {
					const houseAddr = `${h.address_no || ''} ${h.village_no || ''}`.toLowerCase();
					if (!houseAddr.includes(addressNoQuery)) {
						return false;
					}
				}

				if (selectedLocation) {
					const subdistrict = (h.subdistrict || '').toLowerCase();
					const district = (h.district || '').toLowerCase();
					const province = (h.province || '').toLowerCase();

					const matchSub =
						!!subdistrict &&
						(subdistrict.includes(selectedLocation.subdistrict.toLowerCase()) ||
							selectedLocation.subdistrict.toLowerCase().includes(subdistrict));
					const matchDist =
						!!district &&
						(district.includes(selectedLocation.district.toLowerCase()) ||
							selectedLocation.district.toLowerCase().includes(district));
					const matchProv =
						!!province &&
						(province.includes(selectedLocation.province.toLowerCase()) ||
							selectedLocation.province.toLowerCase().includes(province));
					if (!matchSub || !matchDist || !matchProv) {
						return false;
					}
				}
				return true;
			});

			if (hhList.length > 0) {
				foundResults = hhList.map((hh) => {
					const members = allEvacuees.filter((e) => e.household_id === hh._id);
					return {
						household: hh,
						evacuee: allEvacuees.find((e) => e._id === hh.head_evacuee_id) || null,
						count: members.length,
						members,
						expanded: false
					};
				});
				searchState = 'found';
				showNewHouseholdForm = false;
				return;
			}
		}

		searchState = 'not_found';
		foundResults = [];
		selectedHouseholdId = null;
		showNewHouseholdForm = false;
	}

	function handleNewHouseholdSubmit(e: Event) {
		e.preventDefault();
		if (onsubmit) {
			onsubmit(formData);
		}
	}
</script>

<div class="space-y-6">
	<!-- Search Section -->
	<form
		class="space-y-4"
		onsubmit={(e) => {
			e.preventDefault();
			doSearch();
		}}
	>
		<!-- Search Mode Toggle -->
		<div class="flex flex-col overflow-hidden rounded-xl bg-muted/50 p-1 sm:flex-row">
			<button
				type="button"
				class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors {searchMode ===
				'exact'
					? 'bg-white text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					searchMode = 'exact';
					searchQuery = '';
					searchAddressNo = '';
					selectedLocationValue = '';
					selectedLocation = null;
					searchState = 'idle';
					showNewHouseholdForm = false;
				}}
			>
				<span class="mr-2 {searchMode === 'exact' ? 'text-primary' : 'text-muted-foreground'}"
					>◉</span
				>
				{t.tabs.person}
			</button>
			<button
				type="button"
				class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors {searchMode ===
				'fuzzy'
					? 'bg-white text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					searchMode = 'fuzzy';
					searchQuery = '';
					searchAddressNo = '';
					selectedLocationValue = '';
					selectedLocation = null;
					searchState = 'idle';
					showNewHouseholdForm = false;
				}}
			>
				<span class="mr-2 {searchMode === 'fuzzy' ? 'text-primary' : 'text-muted-foreground'}"
					>◎</span
				>
				{t.tabs.address}
			</button>
		</div>

		{#if searchMode === 'exact'}
			<div class="space-y-3">
				<Label class="text-sm font-medium">{t.personSearch.label}</Label>
				<div class="flex flex-col gap-3 sm:flex-row">
					<div class="relative flex-1">
						<Search
							class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							bind:value={searchQuery}
							placeholder={t.personSearch.placeholder}
							class="h-12 bg-muted/20 pl-9 sm:h-11"
						/>
					</div>
					<Button type="submit" variant="default" class="h-12 px-6 sm:h-11">
						<Search class="mr-2 h-4 w-4" />
						{t.personSearch.btnSearch}
					</Button>
					<Button
						type="button"
						variant="secondary"
						class="h-12 sm:h-11"
						onclick={() => {
							showNewHouseholdForm = true;
							selectedHouseholdId = null;
						}}
					>
						<Plus class="mr-2 h-4 w-4" />
						{t.personSearch.btnNew}
					</Button>
				</div>
			</div>
		{:else}
			<div class="space-y-4">
				{#if locationsError}
					<div
						class="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
						role="alert"
					>
						<p>{locationsError}</p>
						<Button type="button" variant="outline" size="sm" onclick={retryLocations}>
							{t.addressSearch.retry}
						</Button>
					</div>
				{/if}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div class="space-y-2">
						<Label class="text-sm font-medium">{t.addressSearch.addressNoLabel}</Label>
						<Input
							bind:value={searchAddressNo}
							placeholder={t.addressSearch.addressNoPlaceholder}
							class="h-12 bg-muted/20 sm:h-11"
						/>
					</div>
					<div class="relative space-y-2">
						<Label class="text-sm font-medium">{t.addressSearch.locationLabel}</Label>
						<SearchSelect
							name="household_location"
							options={locationItems}
							bind:value={selectedLocationValue}
							placeholder={t.addressSearch.locationPlaceholder}
							loading={locationsLoading}
							loadingText={t.addressSearch.locationLoading}
							disabled={!!locationsError}
							class="h-12 rounded-md border-border bg-muted/20 sm:h-11"
						/>
					</div>
				</div>

				<Button
					type="submit"
					variant="default"
					class="flex h-12 w-full items-center justify-center gap-2 rounded-xl font-bold"
				>
					<Search class="mr-2 h-4 w-4" />
					{t.addressSearch.btnSearch}
				</Button>
			</div>
		{/if}
	</form>

	<!-- Found Alert -->
	{#if searchState === 'found' && foundResults.length > 0}
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-lg font-bold">
				{t.results.foundCount(foundResults.length)}
			</h3>

			<div class="space-y-3">
				{#each foundResults as result (result.household._id)}
					{@const isSelected = selectedHouseholdId === result.household._id}
					<div
						class="rounded-xl border {isSelected
							? 'border-green-300 bg-[#f0fdf4]'
							: 'border-border bg-white'} flex flex-col gap-4 p-4 shadow-sm transition-all"
					>
						<div
							class="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center"
						>
							<div class="flex-1 space-y-2">
								<div class="flex flex-wrap items-center gap-2">
									<User class="h-5 w-5 text-[#003B71]" />
									<span class="text-sm font-bold"
										>{t.results.headLabel}
										{result.evacuee
											? `${result.evacuee.first_name} ${result.evacuee.last_name}`
											: result.household.label}</span
									>
									<button
										type="button"
										class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors select-none
											{result.expanded
											? 'border-blue-600 bg-white text-blue-700'
											: 'border-transparent bg-blue-50 text-blue-700 hover:bg-blue-100'}"
										onclick={() => (result.expanded = !result.expanded)}
									>
										{t.results.memberCount(result.count > 0 ? result.count : 1)}
										{#if result.expanded}
											<ChevronUp class="h-3 w-3" />
										{:else}
											<ChevronDown class="h-3 w-3" />
										{/if}
									</button>
								</div>
								<div class="ml-[2px] flex items-start gap-2 text-sm text-muted-foreground">
									<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
									<span>{t.results.addressLabel} {formatAddress(result.household)}</span>
								</div>
							</div>
							<Button
								variant="outline"
								class="h-10 shrink-0 rounded-xl px-4 font-medium {isSelected
									? 'border-transparent bg-[#00a86b] text-white hover:bg-[#00905a]'
									: 'border-border bg-gray-50 text-foreground hover:bg-gray-100'}"
								onclick={() => {
									selectedHouseholdId = result.household._id;
									onselect?.(result.household);
								}}
							>
								{#if isSelected}
									<Check class="mr-2 h-4 w-4" /> {t.results.btnJoined}
								{:else}
									<span
										class="mr-2 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-muted-foreground"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-transparent"></span>
									</span>
									{t.results.btnJoin}
								{/if}
							</Button>
						</div>

						{#if result.expanded}
							<div class="mt-1 border-t pt-4">
								<h4 class="mb-3 text-sm font-bold text-[#003B71]">{t.results.membersTitle}</h4>

								{#if result.members.filter((m) => m._id !== result.household.head_evacuee_id).length > 0}
									<ul class="space-y-2 pl-1 text-sm text-muted-foreground">
										{#each result.members.filter((m) => m._id !== result.household.head_evacuee_id) as member (member._id)}
											<li class="flex items-center gap-2">
												<span class="h-1.5 w-1.5 rounded-full bg-blue-300"></span>
												<span class="font-medium text-foreground"
													>{member.first_name} {member.last_name}</span
												>
												<span class="text-xs opacity-70">
													({member.person_id?.number
														? member.person_id.number
														: member.phone
															? member.phone
															: t.results.noId})
												</span>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="text-sm text-muted-foreground italic">
										{t.results.noOtherMembers}
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<button
				type="button"
				class="mt-4 ml-1 flex items-center gap-1 text-sm font-semibold text-[#003B71] hover:underline"
				onclick={() => {
					showNewHouseholdForm = true;
					selectedHouseholdId = null;
				}}
			>
				<Plus class="h-4 w-4" />
				{t.results.btnSeparateNew}
			</button>
		</div>

		<!-- Selected Alert -->
		{#if selectedResult}
			<div class="mt-6 rounded-xl border border-green-200 bg-[#ecfdf5] p-4 md:p-5">
				<div class="flex items-start gap-3">
					<CheckSquare class="mt-0.5 h-6 w-6 shrink-0 text-[#00a86b]" />
					<div class="space-y-1.5 text-green-900">
						<div class="text-base font-bold">{t.results.selectedTitle}</div>
						<div class="text-sm">
							{t.results.headLabel}
							{selectedResult.evacuee
								? `${selectedResult.evacuee.first_name} ${selectedResult.evacuee.last_name}`
								: selectedResult.household.label} ({selectedResult.count > 0
								? selectedResult.count
								: 1} คน)
						</div>
						<div class="mt-2 text-sm">
							<strong>{t.results.addressLabel}</strong>
							{formatAddress(selectedResult.household)}
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Not Found Alert -->
	{#if searchState === 'not_found' && !showNewHouseholdForm}
		<div
			class="flex flex-col items-center justify-center gap-4 px-2 py-6 text-center"
			role="status"
		>
			<div class="flex items-center gap-2 text-base font-bold text-red-600">
				<X class="h-6 w-6 stroke-[3]" />
				{t.notFound.title}
			</div>
			<Button
				type="button"
				variant="default"
				class="h-12 w-full rounded-xl px-6 sm:h-10 sm:w-auto"
				onclick={() => (showNewHouseholdForm = true)}
			>
				<Plus class="mr-2 h-4 w-4" />
				{t.notFound.btnNew}
			</Button>
		</div>
	{/if}

	<!-- New Household Form -->
	{#if showNewHouseholdForm}
		<form class="space-y-6 border-t border-border pt-6" onsubmit={handleNewHouseholdSubmit}>
			<div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
				<div>
					<h3 class="flex items-center gap-2 text-lg font-bold">
						🏡 {t.newForm.title}
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{t.notFound.desc}
					</p>
				</div>
			</div>

			{#if initialAddress && (initialAddress.province || initialAddress.address_no)}
				<div
					class="rounded-xl border border-cyan-300 bg-cyan-50/80 p-3.5 text-xs text-cyan-900 shadow-sm dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200"
				>
					<div class="flex items-center gap-2 font-bold text-cyan-950 dark:text-cyan-100">
						<Cpu class="size-4 text-cyan-700 dark:text-cyan-400" />
						<span>ที่อยู่ตามทะเบียนบ้านดึงมาจากบัตรประชาชน (Autofilled)</span>
					</div>
					<p class="mt-1 text-cyan-800/90 dark:text-cyan-300/90">
						โปรดสอบถามยืนยันกับผู้ประสบภัยว่าปัจจุบันพักอาศัยอยู่ที่นี่จริงหรือไม่
						หากไม่ตรงสามารถพิมพ์แก้ไขในช่องด้านล่างได้ทันที
					</p>
				</div>
			{/if}

			<div class="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.addressNoLabel}</Label>
					<Input
						bind:value={formData.address_no}
						placeholder={t.newForm.addressNoPlaceholder}
						class="h-9 bg-background"
						required
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.villageNoLabel}</Label>
					<Input
						bind:value={formData.village_no}
						placeholder={t.newForm.villageNoPlaceholder}
						class="h-9 bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.provinceLabel}</Label>
					<SearchSelect
						name="province"
						options={provinceItems}
						bind:value={() => formData.province ?? '', (v) => selectProvince(v || null)}
						placeholder={provincesQuery.isLoading ? t.newForm.loading : t.newForm.provinceSelect}
						searchPlaceholder={t.newForm.provinceSearch}
						emptyText={t.newForm.provinceEmpty}
						disabled={pending || provincesQuery.isLoading}
						class="h-9 rounded-md border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.districtLabel}</Label>
					<SearchSelect
						name="district"
						options={districtItems}
						bind:value={() => formData.district ?? '', (v) => selectDistrict(v || null)}
						placeholder={!formData.province
							? t.newForm.provinceSelect
							: districtsQuery.isLoading
								? t.newForm.loading
								: t.newForm.districtSelect}
						searchPlaceholder={t.newForm.districtSearch}
						emptyText={t.newForm.districtEmpty}
						disabled={pending || !formData.province || districtsQuery.isLoading}
						class="h-9 rounded-md border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.subdistrictLabel}</Label>
					<SearchSelect
						name="subdistrict"
						options={subdistrictItems}
						bind:value={() => formData.subdistrict ?? '', (v) => selectSubdistrict(v || null)}
						placeholder={!formData.district
							? t.newForm.districtSelect
							: subdistrictsQuery.isLoading
								? t.newForm.loading
								: t.newForm.subdistrictSelect}
						searchPlaceholder={t.newForm.subdistrictSearch}
						emptyText={t.newForm.subdistrictEmpty}
						disabled={pending || !formData.district || subdistrictsQuery.isLoading}
						class="h-9 rounded-md border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">{t.newForm.postalCodeLabel}</Label>
					<Input
						bind:value={formData.postal_code}
						disabled={pending || !formData.subdistrict}
						placeholder={!formData.subdistrict
							? t.newForm.subdistrictSelect
							: t.newForm.postalCodePlaceholder}
						class="h-9 rounded-md border-border bg-background"
						required
					/>
				</div>
			</div>

			<div class="mt-8 flex flex-col gap-3 border-t pt-6 sm:flex-row-reverse sm:justify-start">
				<Button
					type="submit"
					variant="default"
					disabled={pending}
					class="h-12 w-full px-6 sm:h-11 sm:w-auto"
				>
					{t.newForm.btnSave}
				</Button>
				<Button
					type="button"
					variant="outline"
					class="h-12 w-full px-6 sm:h-11 sm:w-auto"
					onclick={() => (showNewHouseholdForm = false)}
				>
					{t.newForm.btnCancel}
				</Button>
			</div>
		</form>
	{/if}
</div>

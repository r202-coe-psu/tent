<script lang="ts">
	import { onMount } from 'svelte';
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import type { LocationRow } from '$lib/features/locations/domain/location';
	import { useProvinces, useDistricts, useSubdistricts } from '$lib/features/locations';
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
	import SearchSelect from '$lib/components/search-select.svelte';
	import { getAllLocations } from '$lib/features/shelters/data/thailand-location.api';

	let {
		allEvacuees = [],
		households = [],
		onsubmit,
		onselect,
		pending = false,
		showNewHouseholdForm = $bindable(false)
	}: {
		allEvacuees?: Evacuee[];
		households?: Household[];
		onsubmit?: (input: Partial<HouseholdInput>) => void;
		onselect?: (household: Household) => void;
		pending?: boolean;
		showNewHouseholdForm?: boolean;
	} = $props();

	let searchMode: 'exact' | 'fuzzy' = $state('exact');
	let searchQuery = $state('');
	let searchAddressNo = $state('');

	let selectedLocationValue = $state('');
	let selectedLocation = $state<LocationRow | null>(null);
	let locationItems = $state.raw<{ value: string; label: string }[]>([]);
	let locationsLoading = $state(true);

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
		} catch (err) {
			console.error('Failed to load locations', err);
		} finally {
			locationsLoading = false;
		}
	});

	$effect(() => {
		if (selectedLocationValue) {
			try {
				selectedLocation = JSON.parse(selectedLocationValue);
			} catch (err) {
				console.error(err);
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
		class="rounded-2xl border border-border bg-card p-6 shadow-sm"
		onsubmit={(e) => {
			e.preventDefault();
			doSearch();
		}}
	>
		<!-- Search Mode Toggle -->
		<div class="mb-6 flex overflow-hidden rounded-xl bg-muted/50 p-1">
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
				> ค้นหาด้วยบุคคล (Exact Match)
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
				> ค้นหาด้วยที่อยู่ (Fuzzy Match)
			</button>
		</div>

		{#if searchMode === 'exact'}
			<div class="space-y-3">
				<Label class="text-sm font-medium">เบอร์โทรศัพท์ หรือ เลขบัตรประจำตัวประชาชน</Label>
				<div class="flex gap-3">
					<div class="relative flex-1">
						<Search
							class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							bind:value={searchQuery}
							placeholder="089-999-9999"
							class="h-11 bg-muted/20 pl-9"
						/>
					</div>
					<Button type="submit" class="h-11 bg-[#003B71] px-6 hover:bg-[#002a50]">
						<Search class="mr-2 h-4 w-4" /> ค้นหาครอบครัว
					</Button>
					<Button
						type="button"
						variant="outline"
						class="h-11 border-[#003B71] text-[#003B71] hover:bg-blue-50"
						onclick={() => {
							showNewHouseholdForm = true;
							selectedHouseholdId = null;
						}}
					>
						<Plus class="mr-2 h-4 w-4" /> ลงทะเบียนเป็นครอบครัวใหม่
					</Button>
				</div>
			</div>
		{:else}
			<div class="space-y-4">
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div class="space-y-2">
						<Label class="text-sm font-medium">บ้านเลขที่ / ซอย / ถนน</Label>
						<Input
							bind:value={searchAddressNo}
							placeholder="พิมพ์ตัวเลขนำหน้า เช่น 12/3 หรือ 45"
							class="h-11 bg-muted/20"
						/>
					</div>
					<div class="relative space-y-2">
						<Label class="text-sm font-medium">ค้นหา ตำบล / อำเภอ / รหัสไปรษณีย์ ( dropdown )</Label
						>
						<SearchSelect
							name="household_location"
							options={locationItems}
							bind:value={selectedLocationValue}
							placeholder="พิมพ์เพื่อค้นหา เช่น บ้านพรุ หรือ 90250"
							loading={locationsLoading}
							loadingText="กำลังโหลดข้อมูลที่อยู่..."
							class="h-11 border-border bg-muted/20"
						/>
					</div>
				</div>

				<Button
					type="submit"
					class="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#003B71] font-bold text-white hover:bg-[#002a50]"
				>
					<Search class="mr-2 h-4 w-4" /> ค้นหาครอบครัวจากที่อยู่ (Fuzzy Match)
				</Button>
			</div>
		{/if}
	</form>

	<!-- Found Alert -->
	{#if searchState === 'found' && foundResults.length > 0}
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-lg font-bold">
				🏡 พบ {foundResults.length} ครอบครัวที่ลงทะเบียนในระบบ
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
									<span class="text-[15px] font-bold"
										>หัวหน้าครอบครัว: {result.evacuee
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
										{result.count > 0 ? result.count : 1} คน (กดดูรายชื่อเพิ่มเติม)
										{#if result.expanded}
											<ChevronUp class="h-3 w-3" />
										{:else}
											<ChevronDown class="h-3 w-3" />
										{/if}
									</button>
								</div>
								<div class="ml-[2px] flex items-start gap-2 text-sm text-muted-foreground">
									<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
									<span>ที่อยู่: {formatAddress(result.household)}</span>
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
									<Check class="mr-2 h-4 w-4" /> เข้าร่วมแล้ว
								{:else}
									<span
										class="mr-2 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-muted-foreground"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-transparent"></span>
									</span>
									เลือกร่วมครอบครัวนี้
								{/if}
							</Button>
						</div>

						{#if result.expanded}
							<div class="mt-1 border-t pt-4">
								<h4 class="mb-3 text-sm font-bold text-[#003B71]">รายชื่อสมาชิกในครอบครัว:</h4>

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
															: 'ไม่มีข้อมูลระบุตัวตน'})
												</span>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="text-sm text-muted-foreground italic">
										ยังไม่มีสมาชิกอื่นในครอบครัวนี้
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
				<Plus class="h-4 w-4" /> หรือ ต้องการลงทะเบียนแยกเป็นครอบครัวใหม่ในที่อยู่นี้
			</button>
		</div>

		<!-- Selected Alert -->
		{#if selectedResult}
			<div
				class="mt-8 rounded-2xl border border-green-200 bg-[#ecfdf5] p-5 shadow-sm transition-all duration-300 md:p-6"
			>
				<div class="flex items-start gap-3">
					<CheckSquare class="mt-0.5 h-6 w-6 shrink-0 text-[#00a86b]" />
					<div class="space-y-1.5 text-green-900">
						<div class="text-[17px] font-bold">คุณเข้าร่วมครอบครัวเรียบร้อย!</div>
						<div class="text-[14px]">
							หัวหน้าครอบครัว: {selectedResult.evacuee
								? `${selectedResult.evacuee.first_name} ${selectedResult.evacuee.last_name}`
								: selectedResult.household.label} ({selectedResult.count > 0
								? selectedResult.count
								: 1} คน)
						</div>
						<div class="mt-2 text-[14px]">
							<strong>ที่อยู่ครอบครัว:</strong>
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
			class="flex flex-col items-center justify-center gap-5 rounded-3xl border border-amber-200 bg-[#fffdf5] px-6 py-10 text-center shadow-sm"
		>
			<div class="flex items-center gap-2 text-lg font-bold text-red-600">
				<X class="h-6 w-6 stroke-[3]" /> ไม่พบครอบครัวลงทะเบียนด้วยข้อมูลนี้ในระบบ
			</div>
			<Button
				type="button"
				class="h-10 rounded-xl bg-[#003B71] px-6 hover:bg-[#002a50]"
				onclick={() => (showNewHouseholdForm = true)}
			>
				<Plus class="mr-2 h-4 w-4" /> ลงทะเบียนเป็นครอบครัวใหม่ที่อยู่นี้
			</Button>
		</div>
	{/if}

	<!-- New Household Form -->
	{#if showNewHouseholdForm}
		<form
			class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8"
			onsubmit={handleNewHouseholdSubmit}
		>
			<div class="mb-6">
				<h3 class="flex items-center gap-2 text-lg font-bold">
					🏡 กรอกข้อมูลที่อยู่ (สร้างครอบครัวใหม่)
				</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					ที่อยู่นี้จะถูกใช้สร้างฐานข้อมูลกลุ่มครอบครัวใหม่ และคุณจะเป็นหัวหน้าครอบครัวโดยอัตโนมัติ
				</p>
			</div>
			<div class="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
				<div class="space-y-3">
					<Label class="font-semibold">บ้านเลขที่</Label>
					<Input
						bind:value={formData.address_no}
						placeholder="เช่น 12/3"
						class="h-11 bg-background"
						required
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">หมู่ที่ / ตรอก / ซอย / ถนน</Label>
					<Input
						bind:value={formData.village_no}
						placeholder="เช่น หมู่ 2"
						class="h-11 bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">จังหวัด</Label>
					<SearchSelect
						name="province"
						options={provinceItems}
						bind:value={() => formData.province ?? '', (v) => selectProvince(v || null)}
						placeholder={provincesQuery.isLoading ? 'กำลังโหลด...' : 'เลือกจังหวัด...'}
						searchPlaceholder="ค้นหาจังหวัด..."
						emptyText="ไม่พบจังหวัด"
						disabled={pending || provincesQuery.isLoading}
						class="h-11 border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">อำเภอ / เขต</Label>
					<SearchSelect
						name="district"
						options={districtItems}
						bind:value={() => formData.district ?? '', (v) => selectDistrict(v || null)}
						placeholder={!formData.province
							? 'เลือกจังหวัดก่อน'
							: districtsQuery.isLoading
								? 'กำลังโหลด...'
								: 'เลือกอำเภอ...'}
						searchPlaceholder="ค้นหาอำเภอ..."
						emptyText="ไม่พบอำเภอ"
						disabled={pending || !formData.province || districtsQuery.isLoading}
						class="h-11 border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">ตำบล / แขวง</Label>
					<SearchSelect
						name="subdistrict"
						options={subdistrictItems}
						bind:value={() => formData.subdistrict ?? '', (v) => selectSubdistrict(v || null)}
						placeholder={!formData.district
							? 'เลือกอำเภอก่อน'
							: subdistrictsQuery.isLoading
								? 'กำลังโหลด...'
								: 'เลือกตำบล...'}
						searchPlaceholder="ค้นหาตำบล..."
						emptyText="ไม่พบตำบล"
						disabled={pending || !formData.district || subdistrictsQuery.isLoading}
						class="h-11 border-border bg-background"
					/>
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">รหัสไปรษณีย์</Label>
					<Input
						bind:value={formData.postal_code}
						disabled={pending || !formData.subdistrict}
						placeholder={!formData.subdistrict ? 'เลือกตำบลก่อน' : 'เช่น 90110'}
						class="h-11 bg-background"
						required
					/>
				</div>
			</div>

			<div class="mt-8 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
				<p class="flex items-start gap-2 text-sm font-medium text-orange-800">
					<span class="mt-0.5 text-base">👑</span>
					<span class="leading-relaxed">
						คุณได้รับการตั้งค่าเป็น <span class="font-bold">หัวหน้าครอบครัว (Family Head)</span>
						ของที่อยู่นี้โดยอัตโนมัติ สมาชิกครอบครัวคนอื่นที่ลงทะเบียนด้วยที่อยู่นี้จะสามารถเข้าร่วมกลุ่มภายหลังได้
					</span>
				</p>
			</div>

			<div class="mt-8 flex justify-end gap-3 border-t pt-6">
				<Button
					type="button"
					variant="outline"
					class="h-11 px-6"
					onclick={() => (showNewHouseholdForm = false)}
				>
					ยกเลิก
				</Button>
				<Button type="submit" disabled={pending} class="h-11 bg-[#003B71] px-6 hover:bg-[#002a50]">
					ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)
				</Button>
			</div>
		</form>
	{/if}
</div>

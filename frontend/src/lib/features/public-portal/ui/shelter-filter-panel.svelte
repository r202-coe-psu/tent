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

	interface Filters {
		search?: string;
		province?: string;
		district?: string;
		subdistrict?: string;
		type?: string;
		distance?: string;
		user_lat?: string | number;
		user_lng?: string | number;
		status?: string;
		hide_full?: boolean | string;
		vulnerable_bed?: boolean;
		vulnerable_wheelchair?: boolean;
		vulnerable_infant?: boolean;
		vulnerable_isolation?: boolean;
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
		action = '/public/shelters',
		userLat = $bindable(''),
		userLng = $bindable('')
	}: {
		filters?: Filters;
		action?: string;
		userLat?: string;
		userLng?: string;
	} = $props();

	let searchQuery = $state<string>('');
	let selectedProvince = $state<string>('');
	let selectedDistrict = $state<string>('');

	$effect(() => {
		searchQuery = filters.search ?? '';
		selectedProvince = filters.province ?? '';
		selectedDistrict = filters.district ?? '';

		if (filters.user_lat && !userLat) userLat = filters.user_lat.toString();
		if (filters.user_lng && !userLng) userLng = filters.user_lng.toString();
	});

	let locationData = $state<{ province: string; district: string }[]>([]);

	let provincesList = $derived([
		{ label: 'จังหวัด (ทั้งหมด)', value: '' },
		...[...new Set(locationData.map((d) => d.province))].sort().map((p) => ({ label: p, value: p }))
	]);

	let districtsList = $derived([
		{ label: 'อำเภอ (ทั้งหมด)', value: '' },
		...[
			...new Set(
				locationData
					.filter((d) => !selectedProvince || d.province === selectedProvince)
					.map((d) => d.district)
			)
		]
			.sort()
			.map((d) => ({ label: d, value: d }))
	]);

	onMount(async () => {
		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(
				(position) => {
					userLat = position.coords.latitude.toString();
					userLng = position.coords.longitude.toString();
				},
				(err) => {
					console.warn('High accuracy failed, falling back:', err);
					navigator.geolocation.getCurrentPosition(
						(pos) => {
							userLat = pos.coords.latitude.toString();
							userLng = pos.coords.longitude.toString();
						},
						(err2) => console.warn('Fallback geolocation error:', err2)
					);
				},
				{ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
			);
		}

		try {
			const res = await fetch('/province_and_district.csv');
			const text = await res.text();
			const lines = text.split('\n').slice(1);
			locationData = lines
				.map((line) => {
					const [p, d] = line.trim().split(',');
					return p && d ? { province: p, district: d } : null;
				})
				.filter(Boolean) as { province: string; district: string }[];
		} catch (err) {
			console.error('Failed to load location data', err);
		}
	});

	let hideFullToggle = $state<boolean>(false);
	$effect(() => {
		hideFullToggle = filters.hide_full === true || filters.hide_full === 'true';
	});
</script>

<div
	class="flex h-[85vh] max-h-[800px] flex-col rounded-2xl border border-border bg-card p-5 shadow-xs"
>
	<div class="mb-4 flex shrink-0 items-center gap-2">
		<Filter class="h-4 w-4 text-primary" />
		<h3 class="font-bold text-foreground">ค้นหาและตัวกรอง</h3>
	</div>

	<form method="GET" {action} class="flex min-h-0 flex-1 flex-col">
		<div class="custom-scrollbar -mr-3 flex-1 overflow-x-hidden overflow-y-auto pr-3">
			<div class="space-y-4">
				<!-- Search -->
				<div class="space-y-1.5">
					<Label for="search" class="text-xs font-semibold text-muted-foreground">ค้นหา</Label>
					<div class="relative">
						<Input
							id="search"
							name="q"
							type="text"
							bind:value={searchQuery}
							placeholder="ชื่อศูนย์, ตำบล..."
							class="w-full rounded-xl pl-9"
						/>
						<Search class="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
					</div>
				</div>
				<!-- Province -->
				<div class="w-full space-y-1.5">
					<Label for="province" class="text-xs font-semibold text-muted-foreground">จังหวัด</Label>
					<SearchSelect
						name="province"
						placeholder="จังหวัด (ทั้งหมด)"
						bind:value={selectedProvince}
						options={provincesList}
					/>
				</div>

				<!-- District -->
				<div class="w-full space-y-1.5">
					<Label for="district" class="text-xs font-semibold text-muted-foreground">อำเภอ/เขต</Label
					>
					<SearchSelect
						name="district"
						placeholder="อำเภอ (ทั้งหมด)"
						bind:value={selectedDistrict}
						options={districtsList}
					/>
				</div>

				<!-- Sub-district -->
				<div class="space-y-1.5">
					<Label for="subdistrict" class="text-xs font-semibold text-muted-foreground"
						>ตำบล/แขวง</Label
					>
					<Select.Root type="single" name="subdistrict" value={filters.subdistrict ?? ''}>
						<Select.Trigger class="w-full rounded-xl">
							<Select.Value placeholder="ตำบล (ทั้งหมด)" />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">ตำบล (ทั้งหมด)</Select.Item>
							<Select.Item value="คอหงส์">คอหงส์</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Type -->
				<div class="space-y-1.5">
					<Label for="type" class="text-xs font-semibold text-muted-foreground"
						>ประเภทศูนย์พักพิง</Label
					>
					<Select.Root type="single" name="type" value={filters.type ?? ''}>
						<Select.Trigger class="w-full rounded-xl">
							<Select.Value placeholder="ประเภท (ทั้งหมด)" />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">ประเภท (ทั้งหมด)</Select.Item>
							<Select.Item value="ศูนย์บริหารส่วนท้องถิ่น">ศูนย์บริหารส่วนท้องถิ่น</Select.Item>
							<Select.Item value="ศูนย์อพยพชั่วคราว">ศูนย์อพยพชั่วคราว</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Distance radio pills -->
				<div class="space-y-3">
					<div class="text-xs font-bold text-foreground">รัศมีจากตำแหน่งของคุณ (GPS)</div>
					<div class="flex gap-2 rounded-lg border border-border bg-muted/20 p-1">
						{#each ['5', '10', '20'] as km (km)}
							<label class="flex-1 cursor-pointer">
								<input
									type="radio"
									name="distance"
									value={km}
									class="peer sr-only"
									checked={filters.distance === km}
								/>
								<div
									class="rounded-md py-1.5 text-center text-[13px] font-medium text-muted-foreground transition-all peer-checked:bg-primary-dark peer-checked:font-bold peer-checked:text-white"
								>
									{km} กม.
								</div>
							</label>
						{/each}
					</div>
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
							>แสดงเฉพาะศูนย์ที่ยังไม่เต็ม</Label
						>
						<span class="text-[11px] text-muted-foreground">ซ่อนศูนย์พักพิงที่ความจุเต็มแล้ว</span>
					</div>
				</div>

				<!-- Advanced Filters -->
				<div class="overflow-hidden rounded-xl border border-border">
					<Accordion.Root type="single" class="w-full">
						<Accordion.Item value="advanced-filters" class="border-none">
							<Accordion.Trigger
								class="px-4 py-3 transition-colors hover:bg-muted/50 hover:no-underline"
							>
								<span class="text-sm font-bold text-primary-dark"
									>ตัวกรองขั้นสูง (Advanced Filters)</span
								>
							</Accordion.Trigger>
							<Accordion.Content class="pb-2">
								<div class="space-y-6 px-2 pt-2 pb-2">
									<!-- Category 1 -->
									<div class="space-y-3 rounded-lg bg-slate-50 p-4">
										<div class="text-[13px] font-bold text-foreground">1. การดูแลกลุ่มเปราะบาง</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="vulnerable_bed"
													checked={filters.vulnerable_bed === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>ต้องการเตียงสำหรับผู้ป่วยติดเตียง</span
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
													>รองรับผู้พิการ / วีลแชร์เข้าถึงได้</span
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
													>ต้องการพื้นที่สำหรับเด็กอ่อน / หญิงตั้งครรภ์</span
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
													>ต้องการห้องแยกกักโรค (Isolation Zone)</span
												>
											</label>
										</div>
									</div>
									<!-- Category 2 -->
									<div class="space-y-3 rounded-lg bg-slate-50 p-4">
										<div class="text-[13px] font-bold text-foreground">2. นโยบายสัตว์เลี้ยง</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="pet_general"
													checked={filters.pet_general === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>🐶 อนุญาตสัตว์เลี้ยงทั่วไป (สุนัขเล็ก, แมว)</span
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
													>🦮 อนุญาตสุนัขขนาดใหญ่</span
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
													>🐄 มีพื้นที่รองรับปศุสัตว์ (วัว, ควาย, แพะ)</span
												>
											</label>
										</div>
									</div>
									<!-- Category 3 -->
									<div class="space-y-3 rounded-lg bg-slate-50 p-4">
										<div class="text-[13px] font-bold text-foreground">3. พื้นที่จอดยานพาหนะ</div>
										<div class="flex flex-col gap-3">
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="parking_car"
													checked={filters.parking_car === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>🚗 มีที่จอดรถยนต์ / กระบะ (และยังไม่เต็ม)</span
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
													>🏍️ มีที่จอดรถจักรยานยนต์</span
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
													>🛥️ มีจุดจอดเรือ / เรืออพยพ</span
												>
											</label>
										</div>
									</div>
									<!-- Category 4 -->
									<div class="space-y-3 rounded-lg bg-slate-50 p-4">
										<div class="text-[13px] font-bold text-foreground">
											4. สาธารณูปโภคและความปลอดภัย
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
													>📶 มีสัญญาณ Wi-Fi ของศูนย์ให้บริการ</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="utility_high_ground"
													checked={filters.utility_high_ground === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>⛰️ อยู่ในพื้นที่สูง (หนีน้ำท่วมขัง)</span
												>
											</label>
											<label class="group flex cursor-pointer items-start gap-3">
												<Checkbox
													name="utility_truck_access"
													checked={filters.utility_truck_access === true}
													class="mt-0.5 rounded shadow-sm"
												/>
												<span
													class="text-xs leading-tight font-medium text-muted-foreground transition-colors group-hover:text-foreground"
													>🛣️ รถบรรทุก / รถใหญ่สามารถขับเข้าถึงได้</span
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
		<div class="shrink-0 border-t border-border pt-4">
			<Button type="submit" size="lg" class="w-full rounded-xl font-bold shadow-sm"
				>ค้นหาและกรองข้อมูล</Button
			>
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

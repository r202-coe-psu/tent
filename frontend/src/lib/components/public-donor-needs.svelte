<script lang="ts">
	import { onMount } from 'svelte';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import X from '@lucide/svelte/icons/x';
	import { getDonationStore } from '../../routes/public/donations/donation.svelte';
	import { PUBLIC_DONATION_CATEGORIES } from '$lib/features/donations';

	const donationStore = getDonationStore();

	interface Need {
		item_id: string;
		name: string;
		qty_needed: number;
		unit: string;
		status: 'open' | 'closed';
	}
	interface ShelterNeeds {
		code: string;
		name: string;
		needs: Need[];
	}

	let shelters = $state<ShelterNeeds[]>([]);
	let isLoading = $state(true);
	let loadError = $state('');
	let search = $state('');
	let filterType = $state('all');
	let isSearchFocused = $state(false);

	let isModalOpen = $state(false);
	let activeShelter = $state<ShelterNeeds | null>(null);

	const suggestions = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return [];
		const set = new Set<string>();
		shelters.forEach((s) => {
			s.needs.forEach((n) => {
				if (n.name.toLowerCase().includes(q)) {
					set.add(n.name);
				}
			});
		});
		return Array.from(set).slice(0, 5);
	});

	onMount(async () => {
		try {
			const res = await fetch('/api/public/v1/needs');
			if (res.ok) {
				shelters = await res.json();
			} else {
				loadError = 'ไม่สามารถโหลดข้อมูลความต้องการได้ในขณะนี้';
			}
		} catch {
			loadError = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			isLoading = false;
		}
	});

	const filteredShelters = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return shelters
			.map((s) => {
				let filteredNeeds = s.needs;
				if (q) {
					filteredNeeds = filteredNeeds.filter(
						(n) => n.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
					);
				}

				if (filterType === 'urgent') {
					filteredNeeds = filteredNeeds.filter((n) => n.status !== 'closed' && n.qty_needed > 0);
				} else if (filterType !== 'all') {
					filteredNeeds = filteredNeeds.filter((n) => {
						const name = n.name.toLowerCase();
						if (filterType === 'food')
							return name.includes('อาหาร') || name.includes('น้ำ') || name.includes('ข้าว');
						if (filterType === 'medicine')
							return name.includes('ยา') || name.includes('พยาบาล') || name.includes('เวชภัณฑ์');
						if (filterType === 'clothing')
							return name.includes('เสื้อ') || name.includes('ผ้า') || name.includes('กางเกง');
						if (filterType === 'supply')
							return (
								name.includes('ของใช้') ||
								name.includes('อุปกรณ์') ||
								name.includes('เต็นท์') ||
								name.includes('เตียง') ||
								name.includes('สบู่') ||
								name.includes('ทิชชู่')
							);
						return true;
					});
				}
				return { ...s, needs: filteredNeeds };
			})
			.filter((s) => s.needs.length > 0 || (search.trim() === '' && filterType === 'all'));
	});

	// แปลงหน่วยจาก catalog (canonical อังกฤษ) → ไทยอ่านง่าย เฉพาะการแสดงผลบนกระดาน (ไม่แตะข้อมูลจริง)
	const UNIT_LABEL: Record<string, string> = {
		kg: 'กก.',
		bottle: 'ขวด',
		bar: 'ก้อน',
		piece: 'ชิ้น',
		tablet: 'เม็ด',
		box: 'กล่อง',
		pack: 'แพ็ค'
	};
	function formatUnit(unit: string): string {
		return UNIT_LABEL[unit] ?? unit;
	}

	// คลิกไอเทมที่ยังขาด → ตั้งศูนย์ปลายทาง (ล็อก) + pre-fill รายการ แล้วไปฟอร์ม
	function pickNeed(shelter: ShelterNeeds, need: Need) {
		if (need.status === 'closed') return;
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.items = [
			{
				id: crypto.randomUUID(),
				item_id: need.item_id,
				name: need.name,
				amount: 1,
				unit: need.unit,
				condition: 'new',
				remark: ''
			}
		];
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}

	// บริจาคให้ศูนย์นี้ (ไม่เจาะจงไอเทม) → ตั้งศูนย์ปลายทาง (ล็อก) แล้วไปฟอร์ม
	function pickShelter(shelter: ShelterNeeds) {
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.items = [
			{
				id: crypto.randomUUID(),
				name: '',
				amount: 1,
				unit: 'ชิ้น',
				condition: 'new',
				remark: ''
			}
		];
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}

	function pickShelterWithNeeds(shelter: ShelterNeeds) {
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;

		const openNeeds = shelter.needs.filter((n) => n.status !== 'closed');
		if (openNeeds.length > 0) {
			donationStore.items = openNeeds.map((n) => ({
				id: crypto.randomUUID(),
				item_id: n.item_id,
				name: n.name,
				amount: n.qty_needed > 0 ? n.qty_needed : 1,
				unit: n.unit,
				condition: 'new',
				remark: ''
			}));
		} else {
			donationStore.items = [
				{
					id: crypto.randomUUID(),
					name: '',
					amount: 1,
					unit: 'ชิ้น',
					condition: 'new',
					remark: ''
				}
			];
		}

		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}

	function openShelterModal(shelter: ShelterNeeds) {
		activeShelter = shelter;
		isModalOpen = true;
	}

	function closeShelterModal() {
		isModalOpen = false;
		activeShelter = null;
	}
</script>

<div class="space-y-6">
	<!-- Search & Filters Container -->
	<div
		class="relative z-10 space-y-5 rounded-2xl border border-[#dadce0] bg-white p-6 text-left shadow-sm md:p-8"
	>
		<div class="flex flex-col gap-5">
			<div>
				<h3 class="text-xl font-black text-[#013365]">ค้นหาศูนย์พักพิง หรือ สิ่งของ</h3>
				<p class="mt-1 text-sm text-slate-500">
					ระบุชื่อศูนย์ หรือสิ่งของที่คุณต้องการช่วยเหลือ เช่น "น้ำดื่ม"
				</p>
			</div>

			<div class="relative w-full">
				<input
					type="text"
					bind:value={search}
					onfocus={() => (isSearchFocused = true)}
					onblur={() => setTimeout(() => (isSearchFocused = false), 200)}
					placeholder="ค้นหาศูนย์ หรือ สิ่งของ เช่น น้ำดื่ม..."
					aria-label="ค้นหาศูนย์พักพิงหรือสิ่งของ"
					class="w-full rounded-xl border-2 border-slate-200 bg-slate-50 py-3.5 pr-4 pl-12 text-base font-semibold text-[#1d1d1f] shadow-sm outline-hidden transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/20"
				/>
				<Search class="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-slate-400" />

				<!-- Dropdown Suggestion -->
				{#if isSearchFocused && search.trim().length > 0}
					<div
						class="absolute top-[calc(100%+8px)] left-0 z-50 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-2 text-left shadow-lg"
					>
						{#each suggestions as sug}
							<button
								type="button"
								onmousedown={() => {
									search = sug;
									isSearchFocused = false;
								}}
								class="w-full cursor-pointer border-b border-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 last:border-0 hover:bg-slate-50"
							>
								{sug}
							</button>
						{/each}
						{#if suggestions.length === 0}
							<div class="px-4 py-3 text-sm text-slate-500">ไม่พบสิ่งของในระบบ</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Filters -->
	<div class="no-scrollbar mb-2 flex gap-2 overflow-x-auto pb-4">
		<button
			type="button"
			onclick={() => (filterType = 'all')}
			class="rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
			'all'
				? 'border-transparent bg-slate-900 text-white shadow-xs'
				: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
		>
			ทั้งหมด
		</button>
		<button
			type="button"
			onclick={() => (filterType = 'urgent')}
			class="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
			'urgent'
				? 'border border-red-200 bg-red-50 text-red-700 shadow-xs'
				: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
		>
			<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
			ด่วนวิกฤต
		</button>
		{#each PUBLIC_DONATION_CATEGORIES as cat (cat.value)}
			<button
				type="button"
				onclick={() => (filterType = cat.value)}
				class="rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
				cat.value
					? 'border-transparent bg-[#013365] text-white shadow-xs'
					: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
			>
				{cat.label}
			</button>
		{/each}
	</div>

	<!-- Webboard Feed Grid -->
	{#if isLoading}
		<div class="py-16 text-center">
			<div
				class="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[#013365] border-t-transparent"
			></div>
			<p class="mt-4 text-sm text-slate-500">กำลังโหลดข้อมูลความต้องการ...</p>
		</div>
	{:else if loadError}
		<p class="py-10 text-center text-sm font-bold text-red-500">{loadError}</p>
	{:else if filteredShelters.length === 0}
		<p class="py-10 text-center text-sm text-slate-400">
			{search.trim() ? 'ไม่พบศูนย์พักพิงหรือสิ่งของที่ค้นหา' : 'ขณะนี้ยังไม่มีรายการความต้องการ'}
		</p>
	{:else}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			{#each filteredShelters as shelter (shelter.code)}
				{@const displayedNeeds = shelter.needs}
				{@const isZeroPending =
					displayedNeeds.length === 0 || displayedNeeds.every((n) => n.status === 'closed')}
				<div
					class="relative flex flex-col overflow-hidden rounded-2xl border border-[#dadce0] bg-white text-left shadow-sm transition-all hover:shadow-md"
				>
					<div class="flex flex-1 flex-col p-5">
						<div class="mb-2 flex items-center gap-2">
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-emerald-700 uppercase shadow-2xs"
							>
								<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
								เปิดรับบริจาค
							</span>
						</div>

						<h3 class="mb-1 text-lg leading-tight font-bold text-slate-900 transition-colors">
							{shelter.name}
						</h3>
						<p class="mb-4 text-xs text-slate-400">
							รหัสศูนย์: {shelter.code} • แจ้งความต้องการสิ่งของสนับสนุนสำหรับผู้ประสบภัยที่พักอาศัยอยู่ในศูนย์นี้
						</p>

						<div class="mb-6 flex flex-1 flex-col gap-1.5">
							{#if displayedNeeds.length === 0}
								<div class="mt-4 text-center text-sm text-slate-500">
									ไม่มีรายละเอียดสิ่งของที่ต้องการ
								</div>
							{/if}

							<!-- Display first 4 needs -->
							{#each displayedNeeds.slice(0, 4) as need (need.item_id)}
								{#if need.status === 'closed'}
									<div class="mt-1 flex items-center gap-2 opacity-50">
										<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"></span>
										<span class="flex-1 truncate text-xs font-bold text-slate-500 line-through">
											{need.name}
										</span>
										<span
											class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-slate-500"
										>
											งดรับ (ครบแล้ว)
										</span>
									</div>
								{:else}
									<button
										type="button"
										onclick={() => pickNeed(shelter, need)}
										class="flex w-full items-start justify-between gap-2 py-0.5 text-left transition hover:opacity-85"
									>
										<span
											class="mt-0.5 flex min-w-0 flex-1 items-start gap-2 text-xs font-bold text-[#c5221f]"
										>
											<span
												class="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500"
											></span>
											<span class="truncate leading-tight">ด่วน! {need.name}</span>
										</span>
										<span
											class="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black whitespace-nowrap text-slate-600 shadow-2xs"
										>
											ขาด {need.qty_needed}
											{formatUnit(need.unit)}
										</span>
									</button>
								{/if}
							{/each}

							{#if displayedNeeds.length > 0}
								<button
									type="button"
									onclick={() => openShelterModal(shelter)}
									class="mt-2 flex items-center gap-1 text-left text-[12px] font-black text-[#013481] hover:underline"
								>
									+ ดูรายละเอียดสิ่งของที่ต้องการทั้งหมด ({displayedNeeds.length} รายการ)
								</button>
							{/if}
						</div>

						<!-- Card Buttons -->
						<div class="mt-auto flex flex-col gap-2 border-t border-slate-100 pt-4">
							{#if !isZeroPending}
								<button
									type="button"
									onclick={() => pickShelterWithNeeds(shelter)}
									class="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-[#013365] px-4 py-2.5 text-[13px] font-bold text-white shadow-xs transition hover:bg-[#1557b0] sm:text-sm"
								>
									บริจาคของตามรายการ
									<ArrowRight class="h-4 w-4" />
								</button>
							{:else}
								<div
									class="flex w-full cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-[12px] font-bold text-slate-400 shadow-xs sm:text-[13px]"
								>
									ศูนย์นี้ได้รับสิ่งของจำเป็นครบถ้วนแล้ว
								</div>
							{/if}
							<button
								type="button"
								onclick={() => pickShelter(shelter)}
								class="flex w-full items-center justify-center gap-2 rounded-xl border border-[#013365]/20 bg-slate-50 px-4 py-2.5 text-[13px] font-bold text-[#013365] transition hover:border-[#013365] hover:bg-[#013365]/5 sm:text-sm"
							>
								บริจาคสิ่งของอื่นๆ
								<PackagePlus class="h-4 w-4" />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Modal Dialog -->
{#if isModalOpen && activeShelter}
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/60 p-4 backdrop-blur-xs duration-200 fade-in"
	>
		<div
			class="flex max-h-[85vh] w-full max-w-lg animate-in flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white text-left shadow-2xl duration-200 zoom-in-95"
		>
			<!-- Header -->
			<div class="flex shrink-0 items-center justify-between bg-[#013481] p-5 text-white">
				<div class="flex items-center gap-3">
					<ClipboardList class="h-5.5 w-5.5 text-white opacity-85" />
					<div>
						<h4 class="text-lg leading-tight font-black tracking-tight">
							รายการสิ่งของที่ต้องการทั้งหมด
						</h4>
						<p class="text-xs font-medium text-white/80">
							{activeShelter.name}
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={closeShelterModal}
					class="rounded-lg p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
				>
					<X class="h-6 w-6" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-6">
				<div class="space-y-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-xs">
					{#each activeShelter.needs as need, index}
						{#if need.status === 'closed'}
							<div
								class="flex items-center gap-2 py-2 opacity-50 grayscale {index > 0
									? 'border-t border-slate-50'
									: ''}"
							>
								<span class="h-2 w-2 shrink-0 rounded-full bg-slate-400"></span>
								<span class="flex-1 truncate text-sm font-bold text-slate-500 line-through">
									{need.name}
								</span>
								<span
									class="rounded bg-slate-100 px-2 py-1 text-xs font-bold whitespace-nowrap text-slate-500"
								>
									งดรับ (ครบแล้ว)
								</span>
							</div>
						{:else}
							<div
								class="flex items-start justify-between gap-3 py-2.5 {index > 0
									? 'border-t border-slate-50'
									: ''}"
							>
								<span
									class="mt-0.5 flex flex-1 items-start gap-2 text-sm font-bold text-emerald-700"
								>
									<span class="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500"
									></span>
									<span class="leading-tight">ด่วน! {need.name}</span>
								</span>
								<span
									class="shrink-0 rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs font-black whitespace-nowrap text-slate-700 shadow-xs"
								>
									ยังขาดอีก {need.qty_needed}
									{formatUnit(need.unit)}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Footer -->
			<div class="flex shrink-0 justify-end border-t border-slate-100 bg-white p-4 sm:w-auto">
				<button
					type="button"
					onclick={() => {
						if (activeShelter) {
							const tempShelter = activeShelter;
							closeShelterModal();
							pickShelterWithNeeds(tempShelter);
						}
					}}
					class="w-full rounded-xl bg-[#013481] px-6 py-3 text-center text-sm font-bold text-white shadow-xs transition hover:bg-[#002244] sm:w-auto"
				>
					บริจาคให้ศูนย์นี้
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>

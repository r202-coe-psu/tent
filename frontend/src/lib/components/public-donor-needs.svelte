<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Search from '@lucide/svelte/icons/search';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Package from '@lucide/svelte/icons/package';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { getDonationStore } from '../../routes/(public)/donations/donation.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	const donationStore = getDonationStore();
	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	interface Need {
		item_id: string;
		name: string;
		raw_name?: string;
		qty_needed: number;
		unit: string;
		status: 'open' | 'closed';
		category?: string;
		urgency?: 'critical' | 'high' | 'normal';
		target?: number;
		received?: number;
		pending?: number;
		image?: string;
	}

	interface ShelterNeeds {
		code: string;
		name: string;
		is_accepting?: boolean;
		needs: Need[];
	}

	let shelters = $state<ShelterNeeds[]>([]);
	let isLoading = $state(true);
	let loadError = $state('');
	let search = $state('');
	let filterType = $state('all');
	let isSearchFocused = $state(false);

	const suggestions = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return [];
		const set = new SvelteSet<string>();
		shelters.forEach((s) => {
			if (s.name.toLowerCase().includes(q)) {
				set.add(s.name);
			}
			s.needs.forEach((n) => {
				const localizedName = formatItemName(n.raw_name || n.name || n.item_id);
				if (localizedName.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) {
					set.add(localizedName);
				}
			});
		});
		return Array.from(set).slice(0, 5);
	});

	onMount(async () => {
		try {
			const res = await fetch('/api/public/v1/needs');
			if (res.ok) {
				const data = await res.json();
				// Enrich needs if some stats are raw
				shelters = (data || []).map((s: ShelterNeeds) => ({
					...s,
					needs: (s.needs || []).map((n) => {
						const qty = Number(n.qty_needed) || 0;
						const target = n.target || (qty > 0 ? qty * 2 : 100);
						const received = n.received ?? Math.max(0, target - qty);
						const pending = n.pending ?? 0;
						return {
							...n,
							raw_name: n.name || n.item_id,
							qty_needed: qty,
							target,
							received,
							pending,
							urgency: n.urgency || (qty >= 50 ? 'critical' : qty > 0 ? 'high' : 'normal')
						};
					})
				}));
			} else {
				loadError = t.errorLoadingNeeds;
			}
		} catch {
			loadError = t.errorConnect;
		} finally {
			isLoading = false;
		}
	});

	// Currently selected shelter for detailed view
	const selectedShelterDetail = $derived(
		shelters.find((s) => s.code === donationStore.selectedShelterForNeeds) || null
	);

	const ITEM_NAMES: Record<string, { th: string; en: string }> = {
		'item:rice': { th: 'ข้าวสาร (อาหารแห้ง)', en: 'Rice (Dry Food)' },
		'item:water': { th: 'น้ำดื่มสะอาด', en: 'Clean Drinking Water' },
		'item:soap': { th: 'สบู่และของใช้ส่วนตัว', en: 'Soap & Personal Care' },
		'item:blanket': { th: 'ผ้าห่มกันหนาว', en: 'Blanket' },
		'item:paracetamol': { th: 'ยาพาราเซตามอล (ยาสามัญ)', en: 'Paracetamol' },
		'item:canned_fish': { th: 'ปลากระป๋อง', en: 'Canned Fish' },
		'item:instant_noodle': { th: 'บะหมี่กึ่งสำเร็จรูป', en: 'Instant Noodles' },
		'item:mosquito_net': { th: 'มุ้งกันยุง', en: 'Mosquito Net' },
		'item:sanitary_pad': { th: 'ผ้าอนามัย', en: 'Sanitary Pads' }
	};

	function formatItemName(rawName: string): string {
		if (!rawName) return langState.current === 'en' ? 'Essential Items' : 'สิ่งของจำเป็น';
		const item = ITEM_NAMES[rawName];
		if (item) return item[langState.current === 'en' ? 'en' : 'th'];
		if (rawName.startsWith('item:')) {
			const clean = rawName.replace('item:', '');
			const match = ITEM_NAMES[`item:${clean}`];
			return match ? match[langState.current === 'en' ? 'en' : 'th'] : clean;
		}
		return rawName;
	}

	const filteredShelters = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return shelters
			.map((s) => {
				let filteredNeeds = s.needs;
				if (q) {
					filteredNeeds = filteredNeeds.filter((n) => {
						const localizedName = formatItemName(n.raw_name || n.name || n.item_id).toLowerCase();
						return (
							localizedName.includes(q) ||
							n.name.toLowerCase().includes(q) ||
							s.name.toLowerCase().includes(q)
						);
					});
				}

				if (filterType === 'critical') {
					filteredNeeds = filteredNeeds.filter(
						(n) => n.status !== 'closed' && (n.urgency === 'critical' || n.qty_needed >= 50)
					);
				} else if (filterType === 'high') {
					filteredNeeds = filteredNeeds.filter(
						(n) =>
							n.status !== 'closed' &&
							(n.urgency === 'high' || (n.qty_needed > 0 && n.qty_needed < 50))
					);
				} else if (filterType === 'normal') {
					filteredNeeds = filteredNeeds.filter((n) => n.status !== 'closed');
				} else if (filterType !== 'all') {
					filteredNeeds = filteredNeeds.filter((n) => {
						const name = (n.raw_name || n.name).toLowerCase();
						const cat = (n.category || '').toLowerCase();
						if (filterType === 'food')
							return (
								cat === 'food' ||
								name.includes('อาหาร') ||
								name.includes('น้ำ') ||
								name.includes('ข้าว') ||
								name.includes('food') ||
								name.includes('rice') ||
								name.includes('water')
							);
						if (filterType === 'medicine')
							return (
								cat === 'medicine' ||
								name.includes('ยา') ||
								name.includes('พยาบาล') ||
								name.includes('เวชภัณฑ์') ||
								name.includes('medicine') ||
								name.includes('medical')
							);
						if (filterType === 'clothing')
							return (
								cat === 'clothing' ||
								name.includes('เสื้อ') ||
								name.includes('ผ้า') ||
								name.includes('กางเกง') ||
								name.includes('cloth') ||
								name.includes('blanket')
							);
						if (filterType === 'supply')
							return (
								cat === 'supply' ||
								name.includes('ของใช้') ||
								name.includes('อุปกรณ์') ||
								name.includes('เต็นท์') ||
								name.includes('เตียง') ||
								name.includes('สบู่') ||
								name.includes('ทิชชู่') ||
								name.includes('supply') ||
								name.includes('tent') ||
								name.includes('soap')
							);
						return true;
					});
				}
				return { ...s, needs: filteredNeeds };
			})
			.filter((s) => s.needs.length > 0 || (search.trim() === '' && filterType === 'all'))
			.sort((a, b) => {
				const aCrit = a.needs.some(
					(n) => n.status !== 'closed' && (n.urgency === 'critical' || n.qty_needed >= 50)
				);
				const bCrit = b.needs.some(
					(n) => n.status !== 'closed' && (n.urgency === 'critical' || n.qty_needed >= 50)
				);
				if (aCrit && !bCrit) return -1;
				if (!aCrit && bCrit) return 1;
				return 0;
			});
	});

	const UNIT_LABEL: Record<string, { th: string; en: string }> = {
		kg: { th: 'กก.', en: 'kg' },
		bottle: { th: 'ขวด', en: 'bottle' },
		bar: { th: 'ก้อน', en: 'bar' },
		piece: { th: 'ชิ้น', en: 'pcs' },
		tablet: { th: 'เม็ด', en: 'tab' },
		box: { th: 'กล่อง', en: 'box' },
		pack: { th: 'แพ็ค', en: 'pack' },
		unit: { th: 'ชิ้น', en: 'unit' }
	};

	function formatUnit(unit: string): string {
		const u = UNIT_LABEL[unit];
		if (u) return u[langState.current === 'en' ? 'en' : 'th'];
		return unit;
	}

	function goToShelterDetails(shelter: ShelterNeeds) {
		donationStore.selectedShelterForNeeds = shelter.code;
		donationStore.activeTab = 'shelter-details';
	}

	function donateSingleNeed(shelter: ShelterNeeds, need: Need) {
		if (need.status === 'closed') return;
		donationStore.flowMode = 'solicited';
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.items = [
			{
				id: crypto.randomUUID(),
				item_id: need.item_id,
				category: need.category || 'food',
				name: formatItemName(need.raw_name || need.name || need.item_id),
				amount: need.qty_needed > 0 ? need.qty_needed : 1,
				unit: formatUnit(need.unit),
				condition: 'new',
				remark: '',
				image: need.image || ''
			}
		];
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}

	function donateOtherItems(shelter: ShelterNeeds) {
		donationStore.flowMode = 'unsolicited';
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.items = [
			{
				id: crypto.randomUUID(),
				category: 'food',
				name: '',
				amount: 1,
				unit: t.defaultItemUnit,
				condition: 'new',
				remark: '',
				image: ''
			}
		];
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}
</script>

{#if donationStore.activeTab === 'shelter-details' && selectedShelterDetail}
	<!-- Subview: Shelter Details (v8.5 View) -->
	<div
		class="mb-8 flex animate-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm duration-300 slide-in-from-right-8"
	>
		<!-- Header -->
		<div
			class="flex flex-col items-start justify-between gap-4 bg-[#013481] p-6 text-white sm:flex-row sm:p-8"
		>
			<div class="flex items-start gap-4">
				<button
					type="button"
					onclick={() => {
						donationStore.activeTab = 'needs';
					}}
					class="-ml-2 shrink-0 cursor-pointer rounded-xl p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
					aria-label={t.backToShelterList}
				>
					<ArrowLeft class="h-6 w-6" />
				</button>
				<div>
					<h2 class="mb-2 text-2xl font-black tracking-tight sm:text-3xl">
						{selectedShelterDetail.name}
					</h2>
					<div class="flex flex-wrap items-center gap-3">
						<span class="flex items-center gap-1.5 text-sm font-medium text-white/80">
							<MapPin class="h-4 w-4" />
							{langState.current === 'en' ? 'Shelter Code:' : 'รหัสศูนย์:'}
							{selectedShelterDetail.code}
						</span>
						<span
							class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-2xs font-bold text-emerald-700 shadow-2xs"
						>
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
							{t.openDonationBadge}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Content -->
		<div class="bg-slate-50 p-6 sm:p-8">
			<div class="mx-auto max-w-4xl space-y-6">
				<div class="flex items-center justify-between">
					<h3 class="flex items-center gap-2 text-xl font-black text-slate-800">
						<ClipboardList class="h-6 w-6 text-[#013481]" />
						{t.shelterNeedsTitle}
					</h3>
				</div>

				{#if selectedShelterDetail.needs.length === 0}
					<div
						class="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500"
					>
						{t.noUrgentItems}
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					{#each selectedShelterDetail.needs as need, index (need.item_id || index)}
						{@const itemName = formatItemName(need.raw_name || need.name || need.item_id)}
						{#if need.status === 'closed'}
							<!-- Overstocked Item Card -->
							<div
								class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/50 p-5 opacity-60 shadow-xs grayscale"
							>
								<div class="flex items-start gap-4">
									<div
										class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
									>
										{#if need.image}
											<img src={need.image} alt={itemName} class="h-full w-full object-cover" />
										{:else}
											<Package class="h-6 w-6 text-slate-400" />
										{/if}
									</div>
									<div class="flex flex-col gap-1">
										<span class="text-lg font-bold text-slate-600 line-through">
											{itemName}
										</span>
										<span
											class="mt-1 w-fit rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600"
										>
											{t.overstocked}
										</span>
									</div>
								</div>
							</div>
						{:else}
							{@const isCritical = need.urgency === 'critical' || need.qty_needed >= 50}
							{@const isHigh = need.urgency === 'high' || (!isCritical && need.qty_needed > 0)}
							{@const target = need.target || (need.qty_needed > 0 ? need.qty_needed * 2 : 100)}
							{@const received = need.received ?? Math.max(0, target - need.qty_needed)}
							{@const pending = need.pending ?? 0}
							{@const receivedPct = target > 0 ? Math.min(100, (received / target) * 100) : 0}
							{@const pendingPct =
								target > 0 ? Math.min(100 - receivedPct, (pending / target) * 100) : 0}

							<!-- Active Need Card -->
							<div
								class="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:border-[#013481]/30 hover:shadow-md"
							>
								<div class="flex flex-1 items-start gap-4">
									<div
										class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50 shadow-inner"
									>
										{#if need.image}
											<img src={need.image} alt={itemName} class="h-full w-full object-cover" />
										{:else}
											<Package class="h-7 w-7 text-slate-300" />
										{/if}
									</div>
									<div class="flex min-w-0 flex-1 flex-col gap-1.5">
										<div class="mb-0.5 flex items-start gap-2">
											<span
												class="mt-2 h-2 w-2 shrink-0 rounded-full {isCritical
													? 'animate-pulse bg-red-500'
													: isHigh
														? 'bg-orange-500'
														: 'bg-emerald-500'}"
											></span>
											<div class="flex flex-col gap-1.5">
												<span
													class="text-lg leading-tight font-bold break-words {isCritical
														? 'text-red-700'
														: isHigh
															? 'text-orange-700'
															: 'text-emerald-700'}"
												>
													{itemName}
												</span>
												<div class="flex flex-wrap gap-1.5">
													{#if isCritical}
														<span
															class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-2xs font-bold tracking-wider text-red-700 uppercase shadow-2xs"
														>
															<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
															></span>
															{t.criticalBadge}
														</span>
													{:else if isHigh}
														<span
															class="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-2xs font-bold tracking-wider text-orange-700 uppercase shadow-2xs"
														>
															<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
															{t.highBadge}
														</span>
													{/if}
												</div>
											</div>
										</div>

										<div class="mt-2 flex flex-wrap items-center gap-2">
											<span
												class="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-black text-slate-700 shadow-xs"
											>
												{need.qty_needed > 0
													? t.needShortage
															.replace('{qty}', String(need.qty_needed))
															.replace('{unit}', formatUnit(need.unit))
															.replace('{pending}', String(pending))
													: t.openIndefinitely}
											</span>
										</div>

										<!-- Progress Bars -->
										<div class="mt-2 flex w-full flex-col gap-1.5">
											<div
												class="flex flex-col gap-0.5 text-2xs leading-tight font-semibold text-slate-500"
											>
												<div class="flex items-center justify-between">
													<span class="text-emerald-700"
														>{t.receivedActual}
														{received}
														{formatUnit(need.unit)}</span
													>
												</div>
												<div class="flex items-center justify-between">
													<span class="text-amber-600"
														>{t.pendingReserved}
														{pending}
														{formatUnit(need.unit)}</span
													>
													<span>{Math.round(receivedPct + pendingPct)}%</span>
												</div>
											</div>
											<div class="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
												<div
													class="h-full bg-emerald-500 transition-all"
													style:width="{receivedPct}%"
												></div>
												<div
													class="h-full bg-amber-400 transition-all"
													style:width="{pendingPct}%"
												></div>
											</div>
										</div>
									</div>
								</div>

								<button
									type="button"
									onclick={() => donateSingleNeed(selectedShelterDetail, need)}
									class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-bold text-emerald-700 transition-all hover:bg-emerald-100"
								>
									{t.donateThisItem}
									<PackagePlus class="h-4 w-4" />
								</button>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Unsolicited Card -->
				<div class="mt-8 border-t border-slate-200 pt-8">
					<div
						class="space-y-4 rounded-2xl border border-[#013481]/10 bg-[#013481]/5 p-6 text-center"
					>
						<h4 class="text-lg font-bold text-[#013481]">
							{t.unsolicitedCardTitle}
						</h4>
						<p class="mx-auto max-w-lg text-sm text-slate-600">
							{t.unsolicitedCardDesc}
						</p>
						<button
							type="button"
							onclick={() => donateOtherItems(selectedShelterDetail)}
							class="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-[#013481] bg-white px-8 py-3 text-sm font-bold text-[#013481] shadow-xs transition-colors hover:bg-[#013481] hover:text-white"
						>
							{t.donateOtherBtn}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{:else}
	<!-- Main Needs Board Feed (Step 1 Overview) -->
	<div class="space-y-6">
		<!-- Search & Filters Container -->
		<div
			class="relative z-10 space-y-5 rounded-2xl border border-[#dadce0] bg-white p-6 text-left shadow-xs md:p-8"
		>
			<div>
				<h3 class="text-xl font-black text-[#013365]">{t.searchTitle}</h3>
				<p class="mt-1 text-sm text-slate-500">
					{t.searchDesc}
				</p>
			</div>

			<div class="relative w-full">
				<Search class="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					bind:value={search}
					onfocus={() => (isSearchFocused = true)}
					onblur={() => setTimeout(() => (isSearchFocused = false), 200)}
					placeholder={t.searchPlaceholder}
					aria-label={t.searchAriaLabel}
					class="w-full rounded-xl border-2 border-slate-200 bg-slate-50 py-3.5 pr-4 pl-12 text-base font-semibold text-[#1d1d1f] shadow-xs outline-hidden transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/20"
				/>

				<!-- Dropdown Suggestion -->
				{#if isSearchFocused && search.trim().length > 0}
					<div
						class="absolute top-[calc(100%+8px)] left-0 z-50 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-2 text-left shadow-lg"
					>
						{#each suggestions as sug (sug)}
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
							<div class="px-4 py-3 text-sm text-slate-500">{t.noItemFound}</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Filters -->
		<div class="no-scrollbar mb-2 flex gap-2 overflow-x-auto pb-4">
			<button
				type="button"
				onclick={() => (filterType = 'all')}
				class="cursor-pointer rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
				'all'
					? 'border-transparent bg-slate-900 text-white shadow-xs'
					: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
			>
				{t.filterAll}
			</button>
			<button
				type="button"
				onclick={() => (filterType = 'critical')}
				class="flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
				'critical'
					? 'border border-red-200 bg-red-50 text-red-700 shadow-xs'
					: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
			>
				<span class="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
				{t.filterCritical}
			</button>
			<button
				type="button"
				onclick={() => (filterType = 'high')}
				class="flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
				'high'
					? 'border border-orange-200 bg-orange-50 text-orange-700 shadow-xs'
					: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
			>
				<span class="h-2 w-2 rounded-full bg-orange-500"></span>
				{t.filterHigh}
			</button>
			<button
				type="button"
				onclick={() => (filterType = 'normal')}
				class="flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors {filterType ===
				'normal'
					? 'border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-xs'
					: 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}"
			>
				<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
				{t.filterNormal}
			</button>
		</div>

		<!-- Feed Grid -->
		{#if isLoading}
			<div class="py-16 text-center">
				<div
					class="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[#013365] border-t-transparent"
				></div>
				<p class="mt-4 text-sm text-slate-500">{t.loadingNeeds}</p>
			</div>
		{:else if loadError}
			<p class="py-10 text-center text-sm font-bold text-red-500">{loadError}</p>
		{:else if filteredShelters.length === 0}
			<p class="py-10 text-center text-sm text-slate-400">
				{search.trim() ? t.noSheltersOrItems : t.noNeedsCurrently}
			</p>
		{:else}
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				{#each filteredShelters as shelter (shelter.code)}
					{@const displayedNeeds = shelter.needs.filter((n) => n.status !== 'closed')}
					{@const hasCritical = displayedNeeds.some(
						(n) => n.urgency === 'critical' || n.qty_needed >= 50
					)}
					{@const totalTarget = displayedNeeds.reduce((sum, n) => sum + (n.target || 100), 0) || 1}
					{@const totalReceived = displayedNeeds.reduce((sum, n) => sum + (n.received || 0), 0)}
					{@const overallPct = Math.min(100, Math.round((totalReceived / totalTarget) * 100))}

					<!-- Shelter Card -->
					<div
						class="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-xs transition-all hover:shadow-md {hasCritical
							? 'border-red-500 ring-1 shadow-red-500/10 ring-red-500/50'
							: 'border-black/[0.04]'}"
					>
						<div class="flex flex-1 flex-col p-5">
							<!-- Status Badge -->
							<div class="mb-2 flex items-center gap-2">
								{#if hasCritical}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-2xs font-bold tracking-wider text-red-700 uppercase shadow-2xs"
									>
										<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"></span>
										{t.criticalBadge}
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-2xs font-bold tracking-wider text-emerald-700 uppercase shadow-2xs"
									>
										<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
										{t.openDonationBadge}
									</span>
								{/if}
							</div>

							<h3
								class="mb-1 text-lg leading-tight font-bold text-[#1d1d1f] transition-colors group-hover:text-[#013365]"
							>
								{shelter.name}
							</h3>
							<p class="mb-4 text-xs font-semibold text-[#86868b]">
								{#if displayedNeeds.length > 0}
									{t.needsCount
										.replace('{count}', String(displayedNeeds.length))
										.replace('{pct}', String(overallPct))}
								{:else}
									{t.shelterSufficient}
								{/if}
							</p>

							<!-- Needs List -->
							<div class="mb-6 flex flex-1 flex-col gap-2">
								{#if displayedNeeds.length === 0}
									<div class="mt-4 text-center text-sm text-slate-500">
										{t.noUrgentItems}
									</div>
								{/if}

								{#each displayedNeeds.slice(0, 3) as need, i (need.item_id || i)}
									{@const isCrit = need.urgency === 'critical' || need.qty_needed >= 50}
									{@const isHig = need.urgency === 'high' || (!isCrit && need.qty_needed > 0)}
									{@const target = need.target || (need.qty_needed > 0 ? need.qty_needed * 2 : 100)}
									{@const received = need.received ?? Math.max(0, target - need.qty_needed)}
									{@const pending = need.pending ?? 0}
									{@const receivedPct = target > 0 ? Math.min(100, (received / target) * 100) : 0}
									{@const pendingPct =
										target > 0 ? Math.min(100 - receivedPct, (pending / target) * 100) : 0}
									{@const itemName = formatItemName(need.raw_name || need.name || need.item_id)}

									<div class="flex flex-col gap-1.5 py-1">
										<div class="flex items-center justify-between gap-2">
											<span
												class="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-bold {isCrit
													? 'text-red-700'
													: isHig
														? 'text-orange-700'
														: 'text-emerald-700'}"
											>
												<span
													class="h-1.5 w-1.5 shrink-0 rounded-full {isCrit
														? 'animate-pulse bg-red-500'
														: isHig
															? 'bg-orange-500'
															: 'bg-emerald-500'}"
												></span>
												<span class="truncate leading-tight">
													{isCrit
														? `${t.urgentPrefix} ${itemName}`
														: isHig
															? `${t.highPrefix} ${itemName}`
															: itemName}
												</span>
											</span>
											<span
												class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-black whitespace-nowrap text-slate-600 shadow-xs"
											>
												{need.qty_needed > 0
													? t.openForMore
															.replace('{qty}', String(need.qty_needed))
															.replace('{unit}', formatUnit(need.unit))
													: t.openFor}
											</span>
										</div>
										<div class="w-full pl-3">
											<div class="flex h-[6px] w-full overflow-hidden rounded-full bg-slate-100">
												<div
													class="h-full bg-emerald-500 transition-all"
													style:width="{receivedPct}%"
												></div>
												<div
													class="h-full bg-amber-400 transition-all"
													style:width="{pendingPct}%"
												></div>
											</div>
										</div>
									</div>
								{/each}

								{#if displayedNeeds.length > 3}
									<div class="mt-1 pl-3">
										<span
											class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-2xs font-bold text-slate-500"
										>
											{t.moreItems.replace('{count}', String(displayedNeeds.length - 3))}
										</span>
									</div>
								{/if}
							</div>

							<!-- Card Action -->
							<div class="mt-auto border-t border-slate-100 pt-4">
								<button
									type="button"
									onclick={() => goToShelterDetails(shelter)}
									class="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#013365] px-4 py-3 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#1557b0] sm:text-sm"
								>
									{t.viewDetailsAndDonate}
									<ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
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

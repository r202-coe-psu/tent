<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { SvelteMap } from 'svelte/reactivity';
	import Search from '@lucide/svelte/icons/search';
	import Package from '@lucide/svelte/icons/package';
	import Building from '@lucide/svelte/icons/building';
	import Users from '@lucide/svelte/icons/users';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Home from '@lucide/svelte/icons/home';
	import Bell from '@lucide/svelte/icons/bell';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Info from '@lucide/svelte/icons/info';

	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import PublicEmergencyModal from '$lib/components/public-emergency-modal.svelte';
	import PublicDonationCard from '$lib/components/public-donation-card.svelte';
	import PublicVolunteerCard from '$lib/components/public-volunteer-card.svelte';
	import { FamilySearchModal } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_PORTAL_HOME_I18N } from '$lib/constants/i18n';

	let { data }: { data: PageData } = $props();

	const t = $derived(getTranslation(PUBLIC_PORTAL_HOME_I18N, langState.current));
	const isEn = $derived(langState.current === 'en');

	let searchQuery = $state('');
	let searchOpen = $state(false);
	let alertsOpen = $state(false);

	let donationScrollContainer = $state<HTMLElement | null>(null);
	let volunteerScrollContainer = $state<HTMLElement | null>(null);

	const announcements = $derived(data.announcements ?? []);
	const announcementsCount = $derived(announcements.length);
	const hasEmergency = $derived(announcements.some((a) => a.severity === 'emergency'));

	$effect(() => {
		if (typeof window !== 'undefined' && window.location.hash === '#announcements') {
			alertsOpen = true;
		}
	});

	function handleSearch() {
		const q = searchQuery.trim();
		if (q) {
			goto(`/search?q=${encodeURIComponent(q)}`);
		} else {
			searchOpen = true;
		}
	}

	function scrollDonations(dir: 'left' | 'right') {
		if (!donationScrollContainer) return;
		const offset = donationScrollContainer.clientWidth * 0.85;
		donationScrollContainer.scrollBy({
			left: dir === 'left' ? -offset : offset,
			behavior: 'smooth'
		});
	}

	function scrollVolunteers(dir: 'left' | 'right') {
		if (!volunteerScrollContainer) return;
		const offset = volunteerScrollContainer.clientWidth * 0.85;
		volunteerScrollContainer.scrollBy({
			left: dir === 'left' ? -offset : offset,
			behavior: 'smooth'
		});
	}

	const ITEM_NAMES: Record<string, { th: string; en: string }> = {
		'item:rice': { th: 'ข้าวสาร (อาหารแห้ง)', en: 'Rice & Dry Food' },
		'item:water': { th: 'น้ำดื่มสะอาด', en: 'Clean Drinking Water' },
		'item:soap': { th: 'สบู่และของใช้ส่วนตัว', en: 'Soap & Personal Toiletries' },
		'item:blanket': { th: 'ผ้าห่มกันหนาว', en: 'Blankets' },
		'item:paracetamol': { th: 'ยาพาราเซตามอล (ยาสามัญ)', en: 'Paracetamol & Basic Medicine' },
		'item:canned_fish': { th: 'ปลากระป๋อง', en: 'Canned Fish' },
		'item:instant_noodle': { th: 'บะหมี่กึ่งสำเร็จรูป', en: 'Instant Noodles' },
		'item:mosquito_net': { th: 'มุ้งกันยุง', en: 'Mosquito Nets' },
		'item:sanitary_pad': { th: 'ผ้าอนามัย', en: 'Sanitary Pads' }
	};

	function formatItemName(rawName: string): string {
		if (!rawName) return isEn ? 'Essential Items' : 'สิ่งของจำเป็น';
		const cleanKey = rawName.startsWith('item:') ? rawName : `item:${rawName}`;
		if (ITEM_NAMES[cleanKey]) {
			return isEn ? ITEM_NAMES[cleanKey].en : ITEM_NAMES[cleanKey].th;
		}
		if (ITEM_NAMES[rawName]) {
			return isEn ? ITEM_NAMES[rawName].en : ITEM_NAMES[rawName].th;
		}
		return rawName;
	}

	const sheltersGeoMap = $derived.by(() => {
		const map = new SvelteMap<
			string,
			{ province: string; district: string; subdistrict: string }
		>();
		for (const s of data.sheltersList || []) {
			map.set(s.code, {
				province: s.province || 'สงขลา',
				district: s.district || 'หาดใหญ่',
				subdistrict: s.subdistrict || 'หาดใหญ่'
			});
		}
		return map;
	});

	// 1. KPI Telemetry stats (live data only, 0 if empty)
	const sheltersCount = $derived(
		data.summary?.shelters_open ?? (data.sheltersList ? data.sheltersList.length : 0)
	);

	const urgentItemsCount = $derived.by(() => {
		let totalNeeds = 0;
		for (const s of data.donationNeeds || []) {
			totalNeeds += (s.needs || []).length;
		}
		return totalNeeds;
	});

	const urgentItemsDeficit = $derived.by(() => {
		let sum = 0;
		for (const s of data.donationNeeds || []) {
			for (const n of s.needs || []) {
				sum += Number(n.qty_needed) || 0;
			}
		}
		return sum.toLocaleString();
	});

	// 2. Urgent Donations Data (Real API Data only)
	const liveDonationCards = $derived.by(() => {
		const list = (data.donationNeeds || []).filter((s) => s.needs && s.needs.length > 0);
		return list.map((s) => {
			const geo = sheltersGeoMap.get(s.code);
			const loc = geo
				? isEn
					? `${geo.subdistrict}, ${geo.district}, ${geo.province}`
					: `ต.${geo.subdistrict} อ.${geo.district} จ.${geo.province}`
				: isEn
					? 'Kho Hong, Hat Yai, Songkhla'
					: 'ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา';

			const formattedNeeds = (s.needs || []).map((n) => formatItemName(n.name || n.item_id));

			let totalQtyNeeded = 0;
			let totalTarget = 0;
			let totalReceived = 0;

			for (const n of s.needs || []) {
				const qty = Number(n.qty_needed) || 0;
				const target = n.target || (qty > 0 ? qty * 2 : 100);
				const rec = n.received ?? Math.max(0, target - qty);
				totalQtyNeeded += qty;
				totalTarget += target;
				totalReceived += rec;
			}

			if (totalTarget === 0) totalTarget = 100;
			const receivedPercent = Math.min(
				100,
				Math.max(0, Math.round((totalReceived / totalTarget) * 100))
			);
			const deficitText = isEn
				? totalQtyNeeded > 0
					? `Need ${totalQtyNeeded.toLocaleString()} more of ${totalTarget.toLocaleString()} pcs`
					: 'Goal reached'
				: totalQtyNeeded > 0
					? `ขาดอีก ${totalQtyNeeded.toLocaleString()} ชิ้น จากเป้า ${totalTarget.toLocaleString()}`
					: 'ได้รับครบตามเป้าหมายแล้ว';

			return {
				id: s.code,
				code: s.code,
				name: s.name,
				status: isEn ? 'Critical' : 'วิกฤติ',
				location: loc,
				needs:
					formattedNeeds.length > 0 ? formattedNeeds : [isEn ? 'Essential Items' : 'สิ่งของจำเป็น'],
				receivedPercent,
				deficitText
			};
		});
	});

	const urgentDonations = $derived(liveDonationCards);

	// 3. Urgent Volunteers Data (Real data only - empty until API/jobs dispatched)
	type VolunteerItem = {
		id: string;
		name: string;
		status: string;
		location: string;
		missions: string[];
		volunteerPercent: number;
		deficitText: string;
	};

	const urgentVolunteers = $derived<VolunteerItem[]>([]);
	const volunteersNeeded = $derived(0);
	const volunteersActive = $derived(0);

	// 4. FAQs from API / CMS (Real data only)
	const faqList = $derived(
		(data.faqs || []).map((f, i) => ({
			id: `faq-${f.id ?? i + 1}`,
			question: isEn && f.question_en ? f.question_en : f.question,
			answer: isEn && f.answer_en ? f.answer_en : f.answer
		}))
	);

	let activeFaq = $state<string>('');
	$effect(() => {
		if (faqList.length > 0 && !faqList.some((f) => f.id === activeFaq)) {
			activeFaq = faqList[0].id;
		}
	});
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<div class="relative w-full overflow-x-clip bg-[#F8FAFC]">
	<!-- Anchor for announcements navigation -->
	<div id="announcements" class="sr-only" aria-hidden="true"></div>

	<!-- 1. Hero Header (Brand Navy with Institutional Authority) -->
	<header
		class="bg-[#0A2647] px-4 pt-10 pb-12 text-center text-white sm:px-6 sm:pt-14 sm:pb-16 lg:px-8"
	>
		<div class="mx-auto max-w-4xl space-y-2.5">
			<h1 class="text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
				{t.heroTitle}
			</h1>
			<p class="text-xs font-normal text-white/80 sm:text-sm">
				{t.heroSubtitle}
			</p>
		</div>

		<!-- 2 Quick Action Cards Inside Hero Area -->
		<div class="mx-auto mt-7 grid max-w-4xl grid-cols-1 gap-4 text-left sm:grid-cols-2">
			<!-- Left Card: ค้นหาศูนย์พักพิง -->
			<div>
				<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white/95 sm:text-sm">
					<Building class="h-4 w-4" />
					<span>{t.findSheltersTag}</span>
				</div>
				<a
					href="/shelters"
					class="group flex min-h-[76px] items-center justify-between rounded-[22px] bg-white p-3 px-3.5 text-left shadow-xs transition-all hover:bg-slate-50/90 sm:min-h-[82px] sm:rounded-[24px] sm:p-3.5 sm:px-5"
				>
					<div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-4">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] text-[#0A2647] transition-colors group-hover:bg-blue-100 sm:h-14 sm:w-14 sm:rounded-2xl"
						>
							<Building class="h-6 w-6 text-[#0A2647] sm:h-7 sm:w-7" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate text-base font-bold tracking-tight text-[#0A2647] sm:text-xl">
								{t.searchSheltersTitle}
							</div>
							<div class="mt-0.5 truncate text-xs font-normal text-slate-500 sm:text-sm">
								{t.searchSheltersSubtitle}
							</div>
						</div>
					</div>
					<div
						class="ml-2 flex h-11 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1F5F9] text-slate-700 transition-colors group-hover:bg-slate-200 sm:h-14 sm:w-14 sm:rounded-2xl"
					>
						<ChevronRight class="h-5 w-5 stroke-[2.5] sm:h-6 sm:w-6" />
					</div>
				</a>
			</div>

			<!-- Right Card: ค้นหาผู้พักพิง / ตามหาญาติ -->
			<div>
				<div class="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white/95 sm:text-sm">
					<Search class="h-4 w-4" />
					<span>{t.searchEvacueesTag}</span>
				</div>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSearch();
					}}
					class="flex min-h-[76px] items-center rounded-[22px] bg-white p-3 px-3.5 text-left shadow-xs transition-all focus-within:ring-2 focus-within:ring-sky-400 sm:min-h-[82px] sm:rounded-[24px] sm:p-3.5 sm:px-5"
				>
					<Search class="mr-2.5 h-4 w-4 shrink-0 text-slate-400 sm:mr-3 sm:h-5 sm:w-5" />
					<input
						type="text"
						bind:value={searchQuery}
						placeholder={t.searchPlaceholder}
						class="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-sm"
					/>
					<button
						type="submit"
						aria-label={t.searchBtn}
						class="ml-2 flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0A2647] px-3.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#081f3a] sm:h-12 sm:rounded-2xl sm:px-5 sm:text-sm"
					>
						<Search class="h-4 w-4 sm:h-4.5 sm:w-4.5" />
						<span>{t.searchBtn}</span>
					</button>
				</form>
			</div>
		</div>
	</header>

	<!-- 2. Main Body Container -->
	<main class="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:space-y-14 sm:px-6 lg:px-8">
		<!-- KPI Summary Metrics (3 Cards) -->
		<section class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<!-- Card 1: 6 ศูนย์ -->
			<div
				class="flex items-center gap-4 rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-2xs sm:p-5"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
				>
					<Building class="h-6 w-6" />
				</div>
				<div class="space-y-0.5">
					<div class="text-xl font-extrabold text-slate-900 tabular-nums sm:text-2xl">
						{sheltersCount}
						{t.sheltersUnit}
					</div>
					<div class="text-xs font-medium text-slate-500">
						{t.sheltersDesc}
					</div>
				</div>
			</div>

			<!-- Card 2: ความต้องการบริจาค -->
			<div
				class="flex items-center gap-4 rounded-2xl border border-orange-200/90 bg-orange-50/20 p-4.5 shadow-2xs sm:p-5"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FF5C00] text-white shadow-xs"
				>
					<Package class="h-6 w-6" />
				</div>
				<div class="space-y-0.5">
					<div class="flex flex-wrap items-baseline gap-1.5">
						<span class="text-xl font-extrabold text-slate-900 tabular-nums sm:text-2xl">
							{urgentItemsCount}
							{t.itemsUnit}
						</span>
						{#if urgentItemsCount > 0}
							<span class="text-xs font-bold text-orange-600 sm:text-sm">
								({isEn ? `${urgentItemsDeficit} pcs lacking` : `ขาดอีก ${urgentItemsDeficit} ชิ้น`})
							</span>
						{:else}
							<span class="text-xs font-medium text-slate-400 sm:text-sm">
								({t.itemsNone})
							</span>
						{/if}
					</div>
					<div class="text-xs font-medium text-slate-500">{t.itemsDesc}</div>
				</div>
			</div>

			<!-- Card 3: จิตอาสา -->
			<div
				class="flex items-center gap-4 rounded-2xl border border-emerald-200/90 bg-emerald-50/20 p-4.5 shadow-2xs sm:p-5"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#059669] text-white shadow-xs"
				>
					<Users class="h-6 w-6" />
				</div>
				<div class="space-y-0.5">
					<div class="flex flex-wrap items-baseline gap-1.5">
						<span class="text-xl font-extrabold text-slate-900 tabular-nums sm:text-2xl">
							{t.volunteersNeededText(volunteersNeeded)}
						</span>
						<span class="text-xs font-bold text-emerald-600 sm:text-sm">
							({t.volunteersActiveText(volunteersActive)})
						</span>
					</div>
					<div class="text-xs font-medium text-slate-500">{t.volunteersDesc}</div>
				</div>
			</div>
		</section>

		<!-- Section 1: ความต้องการบริจาคด่วน -->
		<section class="space-y-3 sm:space-y-4">
			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
				<!-- Title & Subtitle -->
				<div class="flex items-center gap-2.5 sm:gap-3">
					<Package class="h-6 w-6 shrink-0 text-[#FF5C00] sm:h-7 sm:w-7" />
					<div>
						<h2 class="text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
							{t.urgentDonationsTitle}
						</h2>
						<p class="text-[11px] text-slate-400 sm:text-xs">{t.urgentDonationsSubtitle}</p>
					</div>
				</div>

				<!-- Action Controls & Carousel Nav -->
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
					<div class="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2.5">
						<a
							href="/donations"
							class="flex items-center justify-center gap-1 rounded-xl bg-[#FF5C00] px-3 py-2 text-center text-xs font-bold whitespace-nowrap text-white shadow-xs transition-colors hover:bg-[#E05200] sm:inline-flex sm:px-5 sm:py-2.5 sm:text-sm"
						>
							<span>{t.allNeedsBtn}</span>
							<span aria-hidden="true">➔</span>
						</a>
						<a
							href="/donations/track"
							class="flex items-center justify-center rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-center text-xs font-semibold whitespace-nowrap text-[#92400E] transition-colors hover:bg-[#FEF3C7] sm:inline-flex sm:px-5 sm:py-2.5 sm:text-sm"
						>
							{t.trackStatusBtn}
						</a>
					</div>
					{#if urgentDonations.length > 1}
						<div class="mx-1 hidden h-6 w-px bg-slate-300 sm:block"></div>
						<!-- Carousel Nav Arrows -->
						<div class="flex items-center justify-end gap-1.5 sm:justify-start">
							<button
								type="button"
								onclick={() => scrollDonations('left')}
								aria-label={t.prevAriaLabel}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 sm:h-9 sm:w-9 sm:rounded-xl"
							>
								<ChevronLeft class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => scrollDonations('right')}
								aria-label={t.nextAriaLabel}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 sm:h-9 sm:w-9 sm:rounded-xl"
							>
								<ChevronRight class="h-4 w-4" />
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Divider line -->
			<div class="my-1.5 border-b border-slate-200 sm:mt-2 sm:mb-4"></div>

			{#if urgentDonations.length > 0}
				<!-- Cards Container -->
				<div
					bind:this={donationScrollContainer}
					class="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 py-1 after:w-2 after:shrink-0 after:content-[''] sm:gap-6 sm:px-0 sm:py-2"
				>
					{#each urgentDonations as item (item.id)}
						<PublicDonationCard {item} />
					{/each}
				</div>
			{:else}
				<!-- Empty State Alert for Urgent Donations -->
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-2xs sm:rounded-3xl sm:p-12"
				>
					<div
						class="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-[#FF5C00] sm:h-16 sm:w-16"
					>
						<Inbox class="h-7 w-7 sm:h-8 sm:w-8" />
					</div>
					<h3 class="text-base font-bold text-slate-900 sm:text-lg">
						{t.donationsEmptyTitle}
					</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500 sm:text-sm">
						{t.donationsEmptyDesc}
					</p>
					<div class="mt-5 flex flex-wrap items-center justify-center gap-3">
						<a
							href="/donations"
							class="inline-flex items-center gap-1.5 rounded-xl bg-[#FF5C00] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#E05200] sm:text-sm"
						>
							<Package class="h-4 w-4" />
							<span>{t.allDonationsLink}</span>
						</a>
						<a
							href="/donations/track"
							class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:text-sm"
						>
							<span>{t.trackDonationLink}</span>
						</a>
					</div>
				</div>
			{/if}
		</section>

		<!-- Section 2: จิตอาสา -->
		<section class="space-y-3 sm:space-y-4">
			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
				<!-- Title & Subtitle -->
				<div class="flex items-center gap-2.5 sm:gap-3">
					<Users class="h-6 w-6 shrink-0 text-[#059669] sm:h-7 sm:w-7" />
					<div>
						<h2 class="text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
							{t.volunteersTitle}
						</h2>
						<p class="text-[11px] text-slate-400 sm:text-xs">
							{t.volunteersSubtitle}
						</p>
					</div>
				</div>

				<!-- Action Controls & Carousel Nav -->
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
					<div class="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2.5">
						<button
							type="button"
							class="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-[#059669] px-3 py-2 text-center text-xs font-bold whitespace-nowrap text-white shadow-xs transition-colors hover:bg-[#047857] sm:inline-flex sm:px-5 sm:py-2.5 sm:text-sm"
						>
							<span>{t.allMissionsBtn}</span>
							<span aria-hidden="true">➔</span>
						</button>
						<button
							type="button"
							class="flex cursor-pointer items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-center text-xs font-semibold whitespace-nowrap text-emerald-800 transition-colors hover:bg-emerald-100/70 sm:inline-flex sm:px-5 sm:py-2.5 sm:text-sm"
						>
							<Home class="h-3.5 w-3.5" />
							<span>{t.hostHouseBtn}</span>
						</button>
					</div>
					{#if urgentVolunteers.length > 1}
						<div class="mx-1 hidden h-6 w-px bg-slate-300 sm:block"></div>
						<!-- Carousel Nav Arrows -->
						<div class="flex items-center justify-end gap-1.5 sm:justify-start">
							<button
								type="button"
								onclick={() => scrollVolunteers('left')}
								aria-label={t.prevAriaLabel}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 sm:h-9 sm:w-9 sm:rounded-xl"
							>
								<ChevronLeft class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => scrollVolunteers('right')}
								aria-label={t.nextAriaLabel}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 sm:h-9 sm:w-9 sm:rounded-xl"
							>
								<ChevronRight class="h-4 w-4" />
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Divider line -->
			<div class="my-1.5 border-b border-slate-200 sm:mt-2 sm:mb-4"></div>

			{#if urgentVolunteers.length > 0}
				<!-- Cards Container -->
				<div
					bind:this={volunteerScrollContainer}
					class="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 py-1 after:w-2 after:shrink-0 after:content-[''] sm:gap-6 sm:px-0 sm:py-2"
				>
					{#each urgentVolunteers as item (item.id)}
						<PublicVolunteerCard {item} />
					{/each}
				</div>
			{:else}
				<!-- Empty State Alert for Volunteers -->
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-2xs sm:rounded-3xl sm:p-12"
				>
					<div
						class="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-[#059669] sm:h-16 sm:w-16"
					>
						<Users class="h-7 w-7 sm:h-8 sm:w-8" />
					</div>
					<h3 class="text-base font-bold text-slate-900 sm:text-lg">
						{t.volunteersEmptyTitle}
					</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500 sm:text-sm">
						{t.volunteersEmptyDesc}
					</p>
					<div class="mt-5 flex flex-wrap items-center justify-center gap-3">
						<button
							type="button"
							class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#059669] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#047857] sm:text-sm"
						>
							<Users class="h-4 w-4" />
							<span>{t.preRegisterVolunteerBtn}</span>
						</button>
						<button
							type="button"
							class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:text-sm"
						>
							<Home class="h-4 w-4" />
							<span>{t.hostHouseInfoBtn}</span>
						</button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Horizontal Divider -->
		<div class="border-t border-slate-300"></div>

		<!-- Section 3: คำถามที่พบบ่อย -->
		<section class="space-y-6 pt-2">
			<div class="text-center">
				<h2 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
					{t.faqSectionTitle}
				</h2>
			</div>

			<div class="mx-auto max-w-4xl">
				{#if faqList.length > 0}
					<Accordion.Root type="single" bind:value={activeFaq} class="space-y-3">
						{#each faqList as faq, i (faq.id)}
							<Accordion.Item
								value={faq.id}
								class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white transition-all duration-200 hover:border-slate-300 data-[state=open]:border-2 data-[state=open]:border-sky-300 data-[state=open]:shadow-2xs"
							>
								<Accordion.Trigger
									class="flex w-full items-center justify-between p-4 text-left hover:no-underline sm:p-5"
								>
									<div class="flex items-center gap-3.5 pr-2">
										<span
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 transition-colors group-aria-expanded/accordion-trigger:bg-[#0A2647] group-aria-expanded/accordion-trigger:text-white group-data-[state=open]/accordion-trigger:bg-[#0A2647] group-data-[state=open]/accordion-trigger:text-white"
										>
											{i + 1}
										</span>
										<span class="text-sm font-bold text-slate-900 sm:text-base">
											{faq.question}
										</span>
									</div>
								</Accordion.Trigger>
								<Accordion.Content
									class="px-5 pt-1 pb-5 text-xs leading-relaxed text-slate-600 sm:px-6 sm:text-sm"
								>
									{faq.answer}
								</Accordion.Content>
							</Accordion.Item>
						{/each}
					</Accordion.Root>
				{:else}
					<!-- Empty State Alert for FAQ -->
					<div
						class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-2xs sm:rounded-3xl sm:p-12"
					>
						<div
							class="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-[#0284C7] sm:h-16 sm:w-16"
						>
							<Info class="h-7 w-7 sm:h-8 sm:w-8" />
						</div>
						<h3 class="text-base font-bold text-slate-900 sm:text-lg">
							{t.faqEmptyTitle}
						</h3>
						<p class="mt-1 max-w-md text-xs text-slate-500 sm:text-sm">
							{t.faqEmptyDesc}
						</p>
					</div>
				{/if}
			</div>
		</section>
	</main>

	<!-- Floating Emergency Action Pills -->
	<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2.5 md:right-6 md:bottom-6">
		<button
			type="button"
			onclick={() => (alertsOpen = true)}
			aria-label={t.emergencyAlertsBtn}
			class="relative hidden items-center justify-center rounded-full bg-[#0284C7] whitespace-nowrap text-white shadow-md transition-all duration-200 hover:bg-[#0369a1] hover:shadow-lg focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 md:inline-flex md:h-auto md:w-full md:gap-2 md:px-4 md:py-2.5 md:text-xs md:font-bold"
		>
			<Bell class="h-4 w-4 shrink-0 text-amber-300" />
			<span>{t.emergencyAlertsBtn}</span>
			{#if announcementsCount > 0}
				<span class="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
					{#if hasEmergency}
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"
						></span>
					{/if}
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
					></span>
				</span>
			{/if}
		</button>
	</div>
</div>

<PublicEmergencyModal bind:open={alertsOpen} {announcements} />
<FamilySearchModal bind:open={searchOpen} />

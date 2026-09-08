<script lang="ts">
	import type { PageData } from './$types';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Search from '@lucide/svelte/icons/search';
	import Package from '@lucide/svelte/icons/package';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Compass from '@lucide/svelte/icons/compass';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Home from '@lucide/svelte/icons/home';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Users from '@lucide/svelte/icons/users';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import PhoneCall from '@lucide/svelte/icons/phone-call';
	import Bell from '@lucide/svelte/icons/bell';

	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import PublicEmergencyBanner from '$lib/components/public-emergency-banner.svelte';
	import PublicQuickServiceCard from '$lib/components/public-quick-service-card.svelte';
	import PublicActionBtn from '$lib/components/public-action-btn.svelte';
	import { FamilySearchModal } from '$lib/features/public-portal';
	import { tokens } from '$lib/tokens';

	let { data }: { data: PageData } = $props();

	let searchOpen = $state(false);

	const faqList = $derived(data.faqs ?? []);
	const defaultOpenFaq = $derived(faqList.length > 0 ? `faq-${faqList[0].id ?? 1}` : undefined);

	// Dynamic calculations with sensible fallbacks for Telemetry
	const totalCapacity = 3080;
	const currentOccupancy = $derived(data.summary?.occupancy_total ?? 639);
	const remainingCapacity = $derived(Math.max(0, totalCapacity - currentOccupancy));
	const sheltersOpen = $derived(data.summary?.shelters_open ?? 6);
	const sheltersTotal = $derived(data.summary?.shelters_total ?? 6);
</script>

<svelte:head>
	<title>Smart Shelter — ศูนย์ช่วยเหลือและพักพิงฉุกเฉิน</title>
</svelte:head>

<div class="relative w-full">
	<!-- 1. Urgent Announcements (if any) -->
	{#if data.announcements && data.announcements.length > 0}
		<div id="announcements" class="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
			{#each data.announcements as announcement (announcement._id)}
				<PublicEmergencyBanner {announcement} />
			{/each}
		</div>
	{/if}

	<!-- 2. Hero Banner (Full-width Brand Navy Header with Institutional Authority) -->
	<header class="bg-[#0A2647] px-4 py-12 text-center text-white sm:py-16">
		<div class="mx-auto max-w-4xl space-y-3">
			<h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
				ศูนย์ช่วยเหลือและพักพิงฉุกเฉิน
			</h1>
			<p class="text-sm font-normal text-white/80 sm:text-base">
				เช็คที่ว่างศูนย์พักพิง • ค้นหาความปลอดภัยญาติ • ส่งต่อความช่วยเหลือ
			</p>
		</div>
	</header>

	<!-- 3. Main Portal Body -->
	<div class="mx-auto max-w-7xl space-y-12 px-4 py-10 sm:space-y-16 sm:px-6 sm:py-14">
		<!-- Section 1: เลือกบริการที่ท่านต้องการ (4 Pillars Architecture) -->
		<section class="space-y-6">
			<div class="border-b border-slate-100 pb-4">
				<div class="flex items-center gap-2.5">
					<div
						class="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-slate-700"
					>
						<Compass class="h-4 w-4" />
					</div>
					<h2 class="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
						เลือกบริการที่ท่านต้องการ
					</h2>
				</div>
				<p class="mt-1 text-xs text-slate-500 sm:text-sm">
					เข้าสู่ช่องทางบริการตามสถานการณ์ของท่านโดยตรง ไม่ต้องผ่านหลายขั้นตอน
				</p>
			</div>

			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
				<!-- Card 1: 1. ค้นหาศูนย์พักพิง (Shelter) -->
				<PublicQuickServiceCard
					title="1. ค้นหาศูนย์พักพิง"
					description="ค้นหาศูนย์พักพิงใกล้ตัว ตรวจสอบเตียงว่าง และลงทะเบียนแจ้งความประสงค์เข้าพักพิงล่วงหน้า"
					icon={ShieldAlert}
					iconClass="bg-red-50 text-red-500"
					cardClass="border-2 border-red-200 hover:border-red-300"
				>
					<PublicActionBtn href="/shelters" colorScheme="destructive" variant="solid">
						ค้นหาศูนย์พักพิง
					</PublicActionBtn>
					<PublicActionBtn href="/pre-register" colorScheme="destructive" variant="subtle">
						ลงทะเบียนเข้าพักล่วงหน้า
					</PublicActionBtn>
				</PublicQuickServiceCard>

				<!-- Card 2: 2. ค้นหาญาติ / ผู้พักพิง (Family Tracing) -->
				<PublicQuickServiceCard
					title="2. ค้นหาญาติ / ผู้พักพิง"
					description="ค้นหารายชื่อผู้พักพิง ตรวจสอบสถานะความปลอดภัย และพิกัดศูนย์พักพิงที่คนในครอบครัวเข้าพักอยู่"
					icon={Search}
					iconClass="bg-sky-50 text-[#0284C7]"
					cardClass="border-2 border-sky-200 hover:border-sky-300"
				>
					<PublicActionBtn
						onclick={() => (searchOpen = true)}
						colorScheme="primary"
						variant="solid"
						icon={ArrowRight}
					>
						ค้นหารายชื่อผู้พักพิง
					</PublicActionBtn>
					<PublicActionBtn href="/shelters" colorScheme="sky" variant="subtle" icon={MapPin}>
						ดูแผนที่พิกัดศูนย์พักพิง
					</PublicActionBtn>
				</PublicQuickServiceCard>

				<!-- Card 3: 3. ผู้บริจาค / มอบเสบียง (Donations) -->
				<PublicQuickServiceCard
					title="3. ผู้บริจาค / มอบเสบียง"
					description="ประสานงานมอบอาหารปรุงสุก น้ำดื่ม สิ่งของจำเป็น หรือสมทบทุนช่วยเหลือผู้ประสบภัย"
					icon={Package}
					iconClass="bg-amber-50 text-amber-500"
					cardClass="border-2 border-amber-200 hover:border-amber-300"
				>
					<PublicActionBtn href="/donations" colorScheme="amber" variant="solid">
						แจ้งความประสงค์บริจาค
					</PublicActionBtn>
					<PublicActionBtn
						href="/donations/track"
						colorScheme="amber"
						variant="subtle"
						icon={ArrowRight}
					>
						ตรวจสอบสถานะการบริจาค
					</PublicActionBtn>
				</PublicQuickServiceCard>

				<!-- Card 4: 4. จิตอาสา / อาสาสมัคร (Volunteers) -->
				<PublicQuickServiceCard
					title="4. จิตอาสา / อาสาสมัคร"
					description="ลงทะเบียนร่วมช่วยเหลือ เลือกลงเวลาตามความถนัด เช่น ทีมแพทย์สนาม ครัวกลาง แพ็คของ และขนย้ายผู้ประสบภัย"
					icon={UserPlus}
					iconClass="bg-emerald-50 text-emerald-500"
					cardClass="border-2 border-emerald-200 hover:border-emerald-300"
				>
					<PublicActionBtn href="/volunteers" colorScheme="emerald" variant="solid">
						สมัครจิตอาสา (เลือกลงเวลา)
					</PublicActionBtn>
					<PublicActionBtn href="/volunteers" colorScheme="emerald" variant="subtle" icon={Home}>
						ลงทะเบียนเปิดบ้านพี่เลี้ยง
					</PublicActionBtn>
				</PublicQuickServiceCard>
			</div>
		</section>

		<!-- Section 2: Telemetry Metrics (4 Cards with 360° Status Matrix) -->
		<section class="space-y-4">
			<div class="flex items-center gap-2">
				<span class="relative flex h-2.5 w-2.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				</span>
				<span class="text-xs font-medium text-slate-600">
					ฐานข้อมูลศูนย์ EOC เรียลไทม์ • อัปเดตล่าสุดเมื่อสักครู่
				</span>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<!-- Metric 1: ศูนย์พักพิงที่เปิดรับได้ (Operational Matrix) -->
				<div class="rounded-2xl {tokens.colors.status.operational.card} p-5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-slate-500">ศูนย์พักพิงที่เปิดรับได้</span>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"
						>
							<Building2 class="h-4 w-4" />
						</div>
					</div>
					<div class="mt-2 flex items-baseline gap-1">
						<span class="text-3xl font-bold text-slate-900 tabular-nums">
							{sheltersOpen}
						</span>
						<span class="text-xs font-normal text-slate-400">
							/{sheltersTotal} แห่ง
						</span>
					</div>
					<div class="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						<span>พร้อมรองรับผู้ประสบภัย</span>
					</div>
				</div>

				<!-- Metric 2: รองรับได้อีก (Operational Capacity) -->
				<div class="rounded-2xl {tokens.colors.status.operational.card} p-5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-slate-500">รองรับได้อีก</span>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"
						>
							<Users class="h-4 w-4" />
						</div>
					</div>
					<div class="mt-2 flex items-baseline gap-1">
						<span class="text-3xl font-bold text-emerald-600 tabular-nums">
							{remainingCapacity.toLocaleString()}
						</span>
						<span class="text-xs font-normal text-slate-400">คน</span>
					</div>
					<div class="mt-2 text-xs text-slate-400">
						จาก {sheltersTotal} ศูนย์หลัก (ความจุรวม {totalCapacity.toLocaleString()} คน)
					</div>
				</div>

				<!-- Metric 3: ผู้ประสบภัยปลอดภัยแล้ว (Logistics / Occupancy Matrix) -->
				<div class="rounded-2xl {tokens.colors.status.logistics.card} p-5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-slate-500">ผู้ประสบภัยปลอดภัยแล้ว</span>
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
							<Users class="h-4 w-4" />
						</div>
					</div>
					<div class="mt-2 flex items-baseline gap-1">
						<span class="text-3xl font-bold text-slate-900 tabular-nums">
							{currentOccupancy.toLocaleString()}
						</span>
						<span class="text-xs font-normal text-slate-400">คน</span>
					</div>
					<div class="mt-2 text-xs text-slate-400">เข้าสู่ระบบพักพิงและได้รับการดูแล</div>
				</div>

				<!-- Metric 4: จิตอาสาลงปฏิบัติงาน (EOC Command Matrix) -->
				<div class="rounded-2xl {tokens.colors.status.eoc.card} p-5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-medium text-slate-500">จิตอาสาลงปฏิบัติงาน</span>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600"
						>
							<HeartHandshake class="h-4 w-4" />
						</div>
					</div>
					<div class="mt-2 flex items-baseline gap-1">
						<span class="text-3xl font-bold text-slate-900 tabular-nums">5</span>
						<span class="text-xs font-normal text-slate-400">นาย</span>
					</div>
					<div class="mt-2 text-xs text-slate-400">ทีมแพทย์ ครัวกลาง ขนย้าย</div>
				</div>
			</div>
		</section>

		<!-- Section 3: คำถามที่พบบ่อยในภาวะภัยพิบัติ (Emergency FAQ with shadcn-svelte Accordion) -->
		<section class="space-y-6 pt-4">
			<div class="text-center">
				<h2 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
					คำถามที่พบบ่อยในภาวะภัยพิบัติ
					<span class="block text-xl font-bold text-slate-900 sm:text-2xl">(Emergency FAQ)</span>
				</h2>
				<p class="mt-2 text-xs text-slate-500 sm:text-sm">
					ข้อสงสัยหลักเกี่ยวกับการเข้าพัก สัตว์เลี้ยง การค้นหาญาติ และการคุ้มครองข้อมูลส่วนบุคคล
				</p>
			</div>

			<div class="mx-auto max-w-4xl">
				{#if faqList.length > 0}
					<Accordion.Root type="single" value={defaultOpenFaq} class="space-y-3">
						{#each faqList as faq, i (faq.id || i)}
							{@const itemId = `faq-${faq.id ?? i + 1}`}
							<Accordion.Item
								value={itemId}
								class="rounded-2xl border border-slate-200/80 bg-white transition-all duration-200 hover:border-slate-300 data-[state=open]:border-2 data-[state=open]:border-sky-300 data-[state=open]:shadow-2xs"
							>
								<Accordion.Trigger
									class="flex w-full items-center justify-between p-4 text-left hover:no-underline sm:p-5"
								>
									<div class="flex items-center gap-3 pr-2">
										<span
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 transition-colors group-data-[state=open]/accordion-trigger:bg-[#0A2647] group-data-[state=open]/accordion-trigger:text-white"
										>
											{i + 1}
										</span>
										<span class="text-xs font-bold text-slate-900 sm:text-sm md:text-base">
											{faq.question}
										</span>
									</div>
								</Accordion.Trigger>
								<Accordion.Content
									class="border-t border-sky-50 px-4 pt-3 pb-4 text-xs leading-relaxed text-slate-600 sm:px-5 sm:pb-5 sm:text-sm"
								>
									{faq.answer}
								</Accordion.Content>
							</Accordion.Item>
						{/each}
					</Accordion.Root>
				{:else}
					<div
						class="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-slate-500"
					>
						<p class="text-sm font-medium">ไม่มีรายการคำถามที่พบบ่อยในขณะนี้</p>
					</div>
				{/if}
			</div>
		</section>
	</div>

	<!-- 4. Floating Emergency Action Pills (Fixed Bottom Right with Civic Light Elevation) -->
	<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2.5 md:right-6 md:bottom-6">
		<a
			href="tel:1669"
			aria-label="1669 โทรฉุกเฉิน"
			title="1669 โทรฉุกเฉิน"
			class="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-md transition-all duration-200 hover:bg-red-700 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2.5 md:text-xs md:font-bold"
		>
			<PhoneCall class="h-5 w-5 md:h-4 md:w-4" />
			<span class="hidden md:inline">1669 โทรฉุกเฉิน</span>
		</a>
		<button
			type="button"
			onclick={() => {
				const el = document.getElementById('announcements');
				if (el) el.scrollIntoView({ behavior: 'smooth' });
			}}
			class="hidden items-center gap-2 rounded-full bg-[#0284C7] px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all duration-200 hover:bg-[#0369a1] hover:shadow-lg focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 md:inline-flex"
		>
			<Bell class="h-4 w-4 text-amber-300" />
			<span>แจ้งเตือนภัย (2)</span>
		</button>
	</div>
</div>

<FamilySearchModal bind:open={searchOpen} />

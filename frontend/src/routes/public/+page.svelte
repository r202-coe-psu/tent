<script lang="ts">
	import type { PageData } from './$types';
	import { onDestroy, onMount } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Navigation from '@lucide/svelte/icons/navigation';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Heart from '@lucide/svelte/icons/heart';
	import FileText from '@lucide/svelte/icons/file-text';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import PhoneCall from '@lucide/svelte/icons/phone-call';
	import Phone from '@lucide/svelte/icons/phone';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Globe from '@lucide/svelte/icons/globe';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Package from '@lucide/svelte/icons/package';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import PublicQuickServiceCard from '$lib/components/public-quick-service-card.svelte';
	import PublicEmergencyBanner from '$lib/components/public-emergency-banner.svelte';
	import PublicHeroMetrics from '$lib/components/public-hero-metrics.svelte';

	let { data }: { data: PageData } = $props();

	// Demo data for shelters in emergency banner
	const alerts = [
		{ name: 'ศูนย์ค่ายทหาร (Primary)', capacity: 'เต็มความจุ (95%)', variant: 'danger' },
		{ name: 'ศูนย์ ม.ราชภัฏ (Secondary)', capacity: 'ว่างรับได้ (40%)', variant: 'success' }
	];

	// OP-7: Polling state
	let lastUpdated = $state(0);
	$effect(() => { if (!lastUpdated) lastUpdated = data.lastUpdated; });
	let isStale = $state(false);
	
	onMount(() => {
		// Mock 10-minute polling (we'll just use a shorter interval for demo)
		const pollInterval = setInterval(() => {
			// Mock refetching
			lastUpdated = Date.now();
			isStale = false;
		}, 600000); // 10 mins

		// Stale threshold 30 minutes check
		const staleCheck = setInterval(() => {
			if (Date.now() - lastUpdated > 1800000) { // 30 mins
				isStale = true;
			}
		}, 60000); // Check every minute

		return () => {
			clearInterval(pollInterval);
			clearInterval(staleCheck);
		};
	});
</script>

<svelte:head>
	<title>Smart Shelter — Public & RFL Portal</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<!-- 1. ประกาศด่วนระดับ 4 (อพยพทันที) -->
	<PublicEmergencyBanner {alerts} />

	<!-- 2. Hero & Real-Time Metrics (T-57) -->
	<PublicHeroMetrics
		summary={data.summary}
		flags={data.flags}
		{lastUpdated}
		{isStale}
	/>

	<!-- 3. เมนูช่องทางบริการความช่วยเหลือและตรวจสอบสิทธิ์ -->
	<section class="mb-12">
		<div class="mb-8">
			<div class="flex items-center gap-2 mb-2">
				<Compass class="h-5 w-5 text-slate-500" />
				<h2 class="text-xl font-bold text-slate-800">เมนูช่องทางบริการความช่วยเหลือและตรวจสอบสิทธิ์</h2>
			</div>
			<p class="text-xs text-slate-500">ดำเนินการติดต่อ ลงทะเบียน หรือประสานขอโอนย้ายเพื่อรับรองความช่วยเหลือที่รวดเร็ว</p>
		</div>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
			<!-- ระเบียบสิทธิ์ผู้ประสบภัย -->
			<PublicQuickServiceCard
				title="ระเบียบสิทธิ์ผู้<br/>ประสบภัย"
				badge="ด่วน<br/>ที่สุด"
				badgeClass="bg-red-50 text-red-600"
				description="ท่านสามารถยื่นขอลงทะเบียนเข้าพัก สแกนเข้าออก หรือจองสิทธิ์ล่วงหน้าเพื่อจัดสรรเต็นท์ส่วนตัว ยา และเครื่องนุ่งห่ม"
				icon={ShieldAlert}
				iconClass="bg-red-50 text-red-500"
			>
				<button class="flex w-full items-center justify-center rounded-xl bg-[#1e3a8a] px-3 py-3 text-xs font-bold text-white transition-colors hover:bg-blue-900 shadow-sm">
					ลงทะเบียน
				</button>
			</PublicQuickServiceCard>

			<!-- สำหรับผู้ใจบุญ / บริจาค -->
			<PublicQuickServiceCard
				title="สำหรับผู้ใจบุญ /<br/>บริจาค"
				badge="Wishlist"
				badgeClass="bg-blue-50 text-blue-600"
				description="ร่วมประสานงานมอบอาหารปรุงสุก วัตถุดิบ น้ำดื่ม หรือสมทบกองทุน EOC ข้อมูลจัดซื้อโปร่งใส ตรวจสอบได้ทันที"
				icon={Package}
				iconClass="bg-blue-50 text-blue-500"
			>
				<button class="flex w-full items-center justify-center rounded-xl bg-[#1e3a8a] px-3 py-3 text-xs font-bold text-white transition-colors hover:bg-blue-900 shadow-sm">
					แจ้งบริจาคสิ่งของล่วงหน้า
				</button>
				<button class="flex w-full items-center justify-center rounded-xl bg-transparent border border-[#1e3a8a]/20 px-3 py-3 text-[11px] font-bold text-[#1e3a8a] transition-colors hover:bg-slate-50 shadow-sm">
					ดูบัญชีรับบริจาค / บอร์ดขอของ
				</button>
			</PublicQuickServiceCard>

			<!-- สำหรับทีมอาสาสมัคร -->
			<PublicQuickServiceCard
				title="สำหรับทีมอาสา<br/>สมัคร"
				badge="ร่วมแรง<br/>กาย"
				badgeClass="bg-green-50 text-green-600"
				description="ร่วมลงทะเบียนจองกะงานฝ่ายสวัสดิการ แจกจ่าย ขนย้าย แพทย์สนาม หรือสนับสนุนเจ้าหน้าที่ ณ พื้นที่อุทกภัยชายแดนใต้"
				icon={UserPlus}
				iconClass="bg-green-50 text-green-500"
			>
				<button class="flex w-full items-center justify-center rounded-xl bg-[#1e3a8a] px-3 py-3 text-xs font-bold text-white transition-colors hover:bg-blue-900 shadow-sm">
					สมัคร / จองกะช่วยเหลือ
				</button>
			</PublicQuickServiceCard>

			<!-- สืบค้นกองสิทธิ์ญาติ -->
			<PublicQuickServiceCard
				title="สืบค้นกองสิทธิ์<br/>ญาติ"
				badge="PDPA<br/>Shield"
				badgeClass="bg-purple-50 text-purple-600"
				description="เช็ครายชื่อผู้ประสบภัย ปลอดภัยในพิกัดศูนย์ควบคุม ตรึงระบบเก็บรวบรวมหลักฐานและส่งต่ออย่างเป็นความลับขั้นสูงสุด"
				icon={Search}
				iconClass="bg-purple-50 text-purple-500"
			>
				<button class="flex w-full items-center justify-center rounded-xl bg-[#1e3a8a] px-3 py-3 text-xs font-bold text-white transition-colors hover:bg-blue-900 shadow-sm">
					ค้นหารายบุคคลด่วนที่สุด
				</button>
			</PublicQuickServiceCard>
		</div>
	</section>

	<!-- 4. Help Center & Emergency Contacts -->
	<div class="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- ศูนย์รวมความช่วยเหลือ (Help Center) -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-xs">
			<div class="mb-5 flex items-center gap-2">
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-muted text-primary"
				>
					<HelpCircle class="h-4 w-4" />
				</div>
				<h2 class="text-lg font-bold text-foreground">ศูนย์รวมความช่วยเหลือ (Help Center)</h2>
			</div>

			<div class="flex flex-col gap-4">
				<div class="rounded-xl border border-border bg-muted/20 p-4">
					<div class="flex items-start gap-3">
						<HelpCircle class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
						<div>
							<h4 class="text-sm font-bold text-foreground">ศูนย์ไหนรับสัตว์เลี้ยงบ้าง?</h4>
							<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
								ศูนย์ ม.หาดใหญ่ (ศูนย์ที่ 3) มีโซนสำหรับสัตว์เลี้ยงเฉพาะ
								แต่ท่านต้องนำกรงหรือสายจูงมาเอง
							</p>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-border bg-muted/20 p-4">
					<div class="flex items-start gap-3">
						<HelpCircle class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
						<div>
							<h4 class="text-sm font-bold text-foreground">มีที่จอดรถไหม?</h4>
							<div class="mt-1.5 border-l-2 border-warning pl-3">
								<p class="text-xs leading-relaxed text-muted-foreground">
									แต่ละศูนย์มีจุดจอดรถชั่วคราว <span class="font-bold text-warning"
										>แต่ศูนย์ไม่รับผิดชอบทรัพย์สินหรือความเสียหายของรถยนต์</span
									> แนะนำให้นำเฉพาะของมีค่าติดตัวมา
								</p>
							</div>
						</div>
					</div>
				</div>

				<a
					href="/public/shelters"
					class="mt-2 flex w-fit items-center gap-2 text-left text-sm font-bold text-primary hover:underline"
				>
					<MapPin class="h-4 w-4" />
					ตรวจสอบพิกัดแผนที่แต่ละศูนย์
					<ExternalLink class="h-3 w-3" />
				</a>
			</div>
		</div>

		<!-- ติดต่อฉุกเฉินและด่วน -->
		<div
			class="flex flex-col justify-center rounded-2xl bg-primary-dark p-6 text-white shadow-lg lg:p-8"
		>
			<div class="mb-4 flex items-center gap-3">
				<PhoneCall class="h-6 w-6 text-chart-2" />
				<h2 class="text-xl font-bold">ติดต่อฉุกเฉินและด่วน</h2>
			</div>
			<p class="mb-6 text-sm text-slate-300">
				ต้องการความช่วยเหลือทางการแพทย์ รถยกเคลื่อนย้าย หรือสอบถามข้อมูลเพิ่มเติม
			</p>

			<div class="flex flex-col gap-3">
				<!-- โทร 1669 -->
				<a
					href="tel:1669"
					class="flex items-center justify-between rounded-xl bg-danger px-5 py-4 font-bold transition-colors hover:bg-danger/90"
				>
					<div class="flex items-center gap-3">
						<Phone class="h-5 w-5 text-white" />
						<span class="text-base text-white">โทร 1669</span>
					</div>
					<span class="rounded-lg bg-white/20 px-3 py-1.5 text-[11px] text-white"
						>เจ็บป่วยฉุกเฉิน</span
					>
				</a>

				<!-- โทร 1784 -->
				<a
					href="tel:1784"
					class="flex items-center justify-between rounded-xl bg-warning px-5 py-4 font-bold transition-colors hover:bg-warning/90"
				>
					<div class="flex items-center gap-3">
						<Phone class="h-5 w-5 text-white" />
						<span class="text-base text-white">โทร 1784</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-[11px] text-white">สายด่วน ปภ.</span>
				</a>

				<!-- LINE / FB (Hidden per T-57 OP-2) -->
				<div class="mt-2 grid-cols-2 gap-3 hidden">
					<!-- LINE -->
					<button
						type="button"
						class="flex items-center justify-center gap-2 rounded-xl bg-chart-2 py-3.5 text-sm font-bold text-white transition-colors hover:bg-chart-2/90"
					>
						<MessageCircle class="h-4.5 w-4.5" />
						ติดต่อผ่าน LINE
					</button>
					<!-- Facebook -->
					<button
						type="button"
						class="flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
					>
						<Globe class="h-4.5 w-4.5" />
						ศูนย์เพจ Facebook
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

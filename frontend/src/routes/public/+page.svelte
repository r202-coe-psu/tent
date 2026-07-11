<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import PhoneCall from '@lucide/svelte/icons/phone-call';
	import Phone from '@lucide/svelte/icons/phone';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Globe from '@lucide/svelte/icons/globe';
	import Package from '@lucide/svelte/icons/package';
	import Compass from '@lucide/svelte/icons/compass';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import PublicQuickServiceCard from '$lib/components/public-quick-service-card.svelte';
	import PublicEmergencyBanner from '$lib/components/public-emergency-banner.svelte';
	import { PublicHeroMetrics } from '$lib/features/public-portal';
	import PublicActionBtn from '$lib/components/public-action-btn.svelte';
	import Button from '$lib/components/ui/button/button.svelte';

	let { data }: { data: PageData } = $props();

	// Demo data for shelters in emergency banner
	const alerts = [
		{ name: 'ศูนย์ค่ายทหาร (Primary)', capacity: 'เต็มความจุ (95%)', variant: 'danger' },
		{ name: 'ศูนย์ ม.ราชภัฏ (Secondary)', capacity: 'ว่างรับได้ (40%)', variant: 'success' }
	];

	// OP-7: Polling state
	let lastUpdated = $state(0);
	$effect(() => {
		if (!lastUpdated) lastUpdated = data.lastUpdated;
	});
	let isStale = $state(false);

	onMount(() => {
		const pollInterval = setInterval(async () => {
			try {
				const response = await fetch('/api/public/v1/transparency/summary');
				if (response.ok) {
					const newData = await response.json();
					data.summary = newData.summary;
					lastUpdated = newData.lastUpdated;
					isStale = newData.isStale;
					data.flags = newData.flags;
				}
			} catch (e) {
				console.error('Polling failed', e);
			}
		}, 600000); // 10 mins

		// Stale threshold 30 minutes check
		const staleCheck = setInterval(() => {
			if (Date.now() - lastUpdated > 1800000) {
				// 30 mins
				isStale = true;
			}
		}, 60000); // Check every minute

		return () => {
			clearInterval(pollInterval);
			clearInterval(staleCheck);
		};
	});

	// Read emergency banner switch from API flags
	let showDemoEmergency = $derived(data.flags?.emergency_mode ?? false);
</script>

<svelte:head>
	<title>Smart Shelter — Public & RFL Portal</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<!-- 1. ประกาศด่วนระดับ 4 (อพยพทันที) -->
	{#if showDemoEmergency}
		<PublicEmergencyBanner {alerts} />
	{/if}

	<!-- 2. Hero & Real-Time Metrics (T-57) -->
	{#if data.isError}
		<div
			class="mb-12 rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive"
		>
			<ShieldAlert class="mx-auto mb-2 h-8 w-8" />
			<h3 class="text-lg font-bold">ระบบขัดข้อง</h3>
			<p class="text-sm">ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่ภายหลัง</p>
		</div>
	{:else}
		<PublicHeroMetrics summary={data.summary} flags={data.flags} {lastUpdated} {isStale} />
	{/if}

	<!-- 3. เมนูช่องทางบริการความช่วยเหลือและตรวจสอบสิทธิ์ -->
	<section class="mb-12">
		<div class="mb-8">
			<div class="mb-2 flex items-center gap-2">
				<Compass class="h-5 w-5 text-muted-foreground" />
				<h2 class="text-xl font-bold text-foreground">
					เมนูช่องทางบริการความช่วยเหลือและตรวจสอบสิทธิ์
				</h2>
			</div>
			<p class="text-xs text-muted-foreground">
				ดำเนินการติดต่อ ลงทะเบียน หรือประสานขอโอนย้ายเพื่อรับรองความช่วยเหลือที่รวดเร็ว
			</p>
		</div>

		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
			<!-- ระเบียบสิทธิ์ผู้ประสบภัย -->
			<PublicQuickServiceCard
				title="ระเบียบสิทธิ์ผู้ประสบภัย"
				badge="ด่วนที่สุด"
				badgeClass="bg-danger-muted text-danger"
				description="ท่านสามารถยื่นขอลงทะเบียนเข้าพัก สแกนเข้าออก หรือจองสิทธิ์ล่วงหน้าเพื่อจัดสรรเต็นท์ส่วนตัว ยา และเครื่องนุ่งห่ม"
				icon={ShieldAlert}
				iconClass="bg-danger-muted/30 text-danger"
			>
				<PublicActionBtn disabled>ลงทะเบียน (เร็วๆนี้)</PublicActionBtn>
			</PublicQuickServiceCard>

			<!-- สำหรับผู้ใจบุญ / บริจาค -->
			<PublicQuickServiceCard
				title="สำหรับผู้ใจบุญ/บริจาค"
				badge="Wishlist"
				badgeClass="bg-primary-muted text-primary"
				description="ร่วมประสานงานมอบอาหารปรุงสุก วัตถุดิบ น้ำดื่ม หรือสมทบกองทุน EOC ข้อมูลจัดซื้อโปร่งใส ตรวจสอบได้ทันที"
				icon={Package}
				iconClass="bg-primary-muted/50 text-primary"
			>
				<PublicActionBtn disabled>แจ้งบริจาคสิ่งของล่วงหน้า (เร็วๆนี้)</PublicActionBtn>
				<PublicActionBtn variant="outline" disabled
					>ดูบัญชีรับบริจาค / บอร์ดขอของ (เร็วๆนี้)</PublicActionBtn
				>
			</PublicQuickServiceCard>

			<!-- สำหรับทีมอาสาสมัคร -->
			<div>
				<PublicQuickServiceCard
					title="สำหรับทีมอาสาสมัคร"
					badge="ร่วมแรงกาย"
					badgeClass="bg-chart-2/15 text-chart-2"
					description="ร่วมลงทะเบียนจองกะงานฝ่ายสวัสดิการ แจกจ่าย ขนย้าย แพทย์สนาม หรือสนับสนุนเจ้าหน้าที่ ณ พื้นที่อุทกภัยชายแดนใต้"
					icon={UserPlus}
					iconClass="bg-chart-2/15 text-chart-2"
				>
					<PublicActionBtn disabled>สมัคร / จองกะช่วยเหลือ (เร็วๆนี้)</PublicActionBtn>
				</PublicQuickServiceCard>
			</div>

			<!-- สืบค้นกองสิทธิ์ญาติ -->
			<PublicQuickServiceCard
				title="สืบค้นกองสิทธิ์ญาติ"
				badge="PDPA Shield"
				badgeClass="bg-accent-purple-muted text-accent-purple"
				description="เช็ครายชื่อผู้ประสบภัย ปลอดภัยในพิกัดศูนย์ควบคุม ตรึงระบบเก็บรวบรวมหลักฐานและส่งต่ออย่างเป็นความลับขั้นสูงสุด"
				icon={Search}
				iconClass="bg-accent-purple-muted/50 text-accent-purple"
			>
				<PublicActionBtn href="/public/search">ค้นหารายบุคคลด่วนที่สุด</PublicActionBtn>
			</PublicQuickServiceCard>
		</div>
	</section>

	<!-- 4. Help Center & Emergency Contacts -->
	<div class="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- ศูนย์รวมความช่วยเหลือ (Help Center) -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-xs">
			<div class="mb-2 flex items-center gap-2">
				<div
					class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-muted text-primary"
				>
					<HelpCircle class="h-4 w-4" />
				</div>
				<h2 class="text-lg font-bold text-foreground">
					ศูนย์รวมความช่วยเหลือ (EOC Help Center & FAQ)
				</h2>
			</div>

			<p class="mb-5 text-sm text-muted-foreground">
				คำถามที่พบบ่อยระดับศูนย์รวมคำชักซ้อมจากประชาชน ดึงพิกัดข้อมูลจัดตั้งเรียลไทม์จากระบบตั้งค่า
				FAQ ของฝ่ายบริหารศูนย์ (EOC Dashboard Setup)
			</p>

			<div class="flex flex-col gap-4">
				<Accordion.Root type="single" value="item-1">
					<Accordion.Item
						value="item-1"
						class="mb-3 rounded-xl border border-border px-4 py-2 shadow-sm"
					>
						<Accordion.Trigger class="text-left hover:no-underline">
							<div class="flex items-center gap-3">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-dark text-xs font-bold text-white"
								>
									1
								</div>
								<span class="text-sm font-bold"
									>การค้นหาญาติหรือครอบครัวที่สูญหายในระบบทำได้อย่างไร?</span
								>
							</div>
						</Accordion.Trigger>
						<Accordion.Content class="pt-2 text-sm leading-relaxed text-muted-foreground">
							ท่านสามารถไปที่เมนู <strong>"สืบค้นกองสิทธิ์ญาติ"</strong> และใช้หมายเลขบัตรประชาชน 13 หลัก,
							ชื่อ-นามสกุล หรือหมายเลขหนังสือเดินทางในการค้นหา ระบบจะแสดงสถานะความปลอดภัยและศูนย์พักพิงที่ญาติของท่านพักอาศัยอยู่ปัจจุบัน
							โดยมีการปกปิดข้อมูลบางส่วนเพื่อความปลอดภัยตามหลัก PDPA
						</Accordion.Content>
					</Accordion.Item>

					<Accordion.Item
						value="item-2"
						class="mb-3 rounded-xl border border-border px-4 py-2 shadow-sm"
					>
						<Accordion.Trigger class="text-left hover:no-underline">
							<div class="flex items-center gap-3">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold text-muted-foreground"
								>
									2
								</div>
								<span class="text-sm font-bold">
									หากต้องการนำสัตว์เลี้ยงหรือมีผู้ป่วยติดเตียง ต้องเลือกศูนย์พักพิงอย่างไร?
								</span>
							</div>
						</Accordion.Trigger>
						<Accordion.Content class="pt-2 text-sm leading-relaxed text-muted-foreground">
							ท่านสามารถใช้ฟังก์ชัน <strong>"ตัวกรองขั้นสูง" (Advanced Filters)</strong> ในหน้าค้นหาศูนย์พักพิง
							เพื่อกรองดูเฉพาะศูนย์ที่มีนโยบายอนุญาตสัตว์เลี้ยง หรือศูนย์ที่มีสิ่งอำนวยความสะดวกรองรับกลุ่มเปราะบาง
							(เช่น เตียงผู้ป่วย, ทางลาดวีลแชร์, ศูนย์พยาบาล) ได้อย่างแม่นยำ
						</Accordion.Content>
					</Accordion.Item>

					<Accordion.Item
						value="item-3"
						class="mb-3 rounded-xl border border-border px-4 py-2 shadow-sm"
					>
						<Accordion.Trigger class="text-left hover:no-underline">
							<div class="flex items-center gap-3">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold text-muted-foreground"
								>
									3
								</div>
								<span class="text-sm font-bold"
									>ความปลอดภัยของข้อมูลส่วนบุคคล (PDPA) ในระบบ Smart Shelter ได้มาตรฐานหรือไม่?</span
								>
							</div>
						</Accordion.Trigger>
						<Accordion.Content class="pt-2 text-sm leading-relaxed text-muted-foreground">
							ระบบของเราปฏิบัติตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) อย่างเคร่งครัด
							ข้อมูลผู้ประสบภัยที่แสดงในหน้าสาธารณะจะถูกเข้ารหัสและเซนเซอร์ (Masked)
							เพื่อป้องกันมิจฉาชีพนำข้อมูลไปบิดเบือน มีเพียงเจ้าหน้าที่ EOC
							ที่ได้รับสิทธิ์เท่านั้นจึงจะดูข้อมูลเชิงลึกได้
						</Accordion.Content>
					</Accordion.Item>

					<Accordion.Item
						value="item-4"
						class="rounded-xl border border-border px-4 py-2 shadow-sm"
					>
						<Accordion.Trigger class="text-left hover:no-underline">
							<div class="flex items-center gap-3">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold text-muted-foreground"
								>
									4
								</div>
								<span class="text-sm font-bold"
									>ประชาชนทั่วไปสามารถมีส่วนร่วมหรือเป็นอาสาสมัครได้อย่างไร?</span
								>
							</div>
						</Accordion.Trigger>
						<Accordion.Content class="pt-2 text-sm leading-relaxed text-muted-foreground">
							ท่านสามารถเลือกเมนู <strong>"สำหรับทีมอาสาสมัคร"</strong>
							เพื่อดูความต้องการบุคลากรในแต่ละพื้นที่ และลงทะเบียนจองกะเวลาทำงานล่วงหน้า หรือเลือกเมนู
							<strong>"สำหรับผู้ใจบุญ/บริจาค"</strong> เพื่อตรวจสอบรายการสิ่งของ (Wishlist) ที่ศูนย์ต่างๆ
							กำลังขาดแคลนได้อย่างโปร่งใส
						</Accordion.Content>
					</Accordion.Item>
				</Accordion.Root>

				<a
					href="/public/shelters"
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-muted/30 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary-muted/50"
				>
					<MapPin class="h-4 w-4" />
					ตรวจสอบพิกัดแผนที่แต่ละศูนย์และบ้านพี่เลี้ยง
					<ExternalLink class="h-3 w-3" />
				</a>
			</div>
		</div>

		<!-- ติดต่อฉุกเฉินและด่วน -->
		<div
			class="flex flex-col justify-center rounded-2xl bg-[#1e293b] p-6 text-white shadow-lg lg:p-8"
		>
			<div
				class="mb-4 inline-flex w-fit items-center rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-wider text-white"
			>
				OPERATIONS ON STANDBY 24/7
			</div>

			<div class="mb-3 flex items-start gap-3">
				<PhoneCall class="mt-1 h-6 w-6 shrink-0 text-chart-2" />
				<h2 class="text-xl leading-tight font-bold">
					ประสานการกู้ชีพฉุกเฉินและหน่วยเคลื่อนที่เร็ว
				</h2>
			</div>
			<p class="mb-6 text-sm leading-relaxed text-white/70">
				หากติดค้างอยู่ในตึกจมน้ำ เจ็บครรภ์คลอด สัตว์มีพิษกัด หรือต้องการรถย้ายระดับสูงพิกัดตำบล
				ประสานงานโดยอัตโนมัติ
			</p>

			<div class="flex flex-col gap-3">
				<!-- โทร 1669 -->
				<a
					href="tel:1669"
					class="flex items-center justify-between rounded-xl bg-danger px-5 py-4 font-bold transition-colors hover:bg-danger/90"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-5 w-5 items-center justify-center rounded-full border border-white text-xs"
						>
							i
						</div>
						<span class="text-base text-white">โทร 1669</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-[11px] text-white"
						>สายด่วนกู้ชีพแพทย์ฉุกเฉิน</span
					>
				</a>

				<!-- โทร 1784 -->
				<a
					href="tel:1784"
					class="flex items-center justify-between rounded-xl bg-warning px-5 py-4 font-bold transition-colors hover:bg-[#b45309]"
				>
					<div class="flex items-center gap-3">
						<PhoneCall class="h-4 w-4 text-white" />
						<span class="text-base text-white">โทร 1784</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-[11px] text-white"
						>ศูนย์เตือนภัย ปภ. พายุคุกคาม</span
					>
				</a>
			</div>
		</div>
	</div>
</div>

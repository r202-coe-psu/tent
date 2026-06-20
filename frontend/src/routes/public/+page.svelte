<script lang="ts">
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
	import PublicQuickServiceCard from '$lib/components/public-quick-service-card.svelte';

	// Demo data for shelters in emergency banner
	const alerts = [
		{ name: 'ศูนย์ค่ายทหาร (Primary)', capacity: 'เต็มความจุ (95%)', variant: 'danger' },
		{ name: 'ศูนย์ ม.ราชภัฏ (Secondary)', capacity: 'ว่างรับได้ (40%)', variant: 'success' }
	];
</script>

<svelte:head>
	<title>Smart Shelter — Public & RFL Portal</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-8 md:px-6">
	<!-- 1. ประกาศด่วนระดับ 4 (อพยพทันที) -->
	<div class="mb-8 overflow-hidden rounded-xl border border-danger-border bg-danger-muted/30 shadow-xs">
		<div class="flex flex-col border-l-4 border-danger p-5 md:flex-row md:items-start md:gap-4">
			<!-- Alert Icon -->
			<div class="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger-muted text-danger md:mb-0">
				<ShieldAlert class="h-6 w-6" />
			</div>
			<!-- Alert Content -->
			<div class="flex-1">
				<h3 class="text-base font-bold text-danger">ประกาศด่วนระดับ 4 (อพยพทันที)</h3>
				<p class="mt-1 text-sm leading-relaxed text-danger-subtle">
					พื้นที่ อ.เมืองน้ำท่วมสูง 1.5 - 2 เมตร กระแสไฟถูกตัด ขอให้ประชาชนในพื้นที่เสี่ยงเคลื่อนย้ายมายังศูนย์พักพิงที่เปิดรับด่วน
				</p>
				<!-- Shelter Badges -->
				<div class="mt-4 flex flex-wrap gap-3">
					{#each alerts as alert}
						<div class="flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 border border-border shadow-2xs">
							<span class="text-xs font-semibold text-card-foreground">{alert.name}</span>
							<span
								class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase
								{alert.variant === 'danger' ? 'bg-danger-muted text-danger' : 'bg-chart-2/15 text-chart-2'}"
							>
								{alert.capacity}
							</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- 2. ค้นหาศูนย์พักพิงใกล้คุณ (Geo-Routing) -->
	<div class="mb-12 overflow-hidden rounded-2xl bg-primary-dark text-primary-foreground shadow-lg">
		<div class="relative px-6 py-12 text-center md:px-12 md:py-16">
			<div class="relative mx-auto max-w-2xl">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/10 text-primary-foreground">
					<MapPin class="h-6 w-6" />
				</div>
				<h2 class="text-2xl font-bold tracking-tight md:text-3xl text-primary-foreground">ค้นหาศูนย์พักพิงใกล้คุณ (Geo-Routing)</h2>
				<p class="mt-2 text-sm text-primary-foreground/80">
					กรุณาระบุตำบล หรือ อำเภอ เพื่อให้ระบบแนะนำศูนย์ที่เดินทางปลอดภัยและยังว่างอยู่
				</p>

				<!-- Search Form -->
				<div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
					<div class="relative flex-1">
						<input
							type="text"
							placeholder="เช่น ต.คอหงส์ หรือ อ.หาดใหญ่"
							class="w-full rounded-xl border-0 bg-card px-4 py-3.5 pl-11 text-sm text-card-foreground shadow-md placeholder-muted-foreground focus:ring-2 focus:ring-primary outline-hidden"
						/>
						<Search class="absolute top-4 left-4 h-4.5 w-4.5 text-muted-foreground" />
					</div>
					<button class="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3.5 text-sm font-bold shadow-md transition-colors cursor-pointer">
						<Navigation class="h-4 w-4" />
						นำทาง
					</button>
				</div>
			</div>
		</div>
	</div>

	<!-- 3. เมนูด่วน (Quick Services) -->
	<section class="mb-12">
		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
			<!-- สำหรับผู้ประสบภัย -->
			<PublicQuickServiceCard
				title="สำหรับผู้ประสบภัย"
				description="ขอความช่วยเหลือและเข้าพัก"
				icon={ShieldAlert}
				iconClass="bg-danger-muted/30 text-danger"
			>
				<button disabled class="flex w-full items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground opacity-55 cursor-not-allowed select-none">
					ลงทะเบียนเข้าศูนย์ล่วงหน้า (เร็วๆ นี้)
					<span class="text-muted-foreground">›</span>
				</button>
				<button disabled class="flex w-full items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground opacity-55 cursor-not-allowed select-none">
					รับ QR Code เข้าศูนย์ด่วน (เร็วๆ นี้)
					<span class="text-muted-foreground">›</span>
				</button>
			</PublicQuickServiceCard>

			<!-- สำหรับผู้บริจาค -->
			<PublicQuickServiceCard
				title="สำหรับผู้บริจาค"
				description="สมทบทุนและสิ่งของจำเป็น"
				icon={Heart}
				iconClass="bg-primary-muted text-primary"
			>
				<a href="/public/donations" class="flex items-center justify-between rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark">
					แจ้งบริจาคสิ่งของล่วงหน้า
					<span class="text-white/70">›</span>
				</a>
				<button disabled class="flex w-full items-center justify-center rounded-lg px-3 py-2.5 text-xs font-semibold text-muted-foreground opacity-55 cursor-not-allowed select-none">
					ดูบัญชีรับบริจาค / Wishlist (เร็วๆ นี้)
					<span class="ml-1">›</span>
				</button>
			</PublicQuickServiceCard>

			<!-- สำหรับอาสาสมัคร -->
			<PublicQuickServiceCard
				title="สำหรับอาสาสมัคร"
				description="ร่วมเป็นส่วนหนึ่งของการช่วยเหลือ"
				icon={UserPlus}
				iconClass="bg-chart-2/15 text-chart-2"
			>
				<a href="/public/volunteers" class="flex items-center justify-between rounded-lg bg-chart-2/10 px-3 py-2.5 text-xs font-semibold text-chart-2 transition-colors hover:bg-chart-2/20">
					สมัคร / จองกะช่วยเหลือ
					<span class="text-chart-2/70">›</span>
				</a>
			</PublicQuickServiceCard>

			<!-- ค้นหาญาติ -->
			<PublicQuickServiceCard
				title="ค้นหาญาติ"
				description="ติดตามสถานะญาติในศูนย์พักพิง"
				icon={Search}
				iconClass="bg-accent-purple-muted/50 text-accent-purple"
			>
				<button disabled class="flex w-full items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground opacity-55 cursor-not-allowed select-none">
					ค้นหาบุคคลที่สูญหาย (เร็วๆ นี้)
					<span class="text-muted-foreground">›</span>
				</button>
			</PublicQuickServiceCard>
		</div>
	</section>

	<!-- 4. Help Center & Emergency Contacts -->
	<div class="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
		<!-- ศูนย์รวมความช่วยเหลือ (Help Center) -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-xs">
			<div class="mb-5 flex items-center gap-2">
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-muted text-primary">
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
								ศูนย์ ม.หาดใหญ่ (ศูนย์ที่ 3) มีโซนสำหรับสัตว์เลี้ยงเฉพาะ แต่ท่านต้องนำกรงหรือสายจูงมาเอง
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
									แต่ละศูนย์มีจุดจอดรถชั่วคราว <span class="font-bold text-warning">แต่ศูนย์ไม่รับผิดชอบทรัพย์สินหรือความเสียหายของรถยนต์</span> แนะนำให้นำเฉพาะของมีค่าติดตัวมา
								</p>
							</div>
						</div>
					</div>
				</div>
				
				<button disabled class="mt-2 flex items-center gap-2 text-sm font-bold text-muted-foreground opacity-55 cursor-not-allowed select-none text-left w-fit">
					<MapPin class="h-4 w-4" />
					ดูพิกัดแผนที่แต่ละศูนย์ (เร็วๆ นี้)
					<ExternalLink class="h-3 w-3" />
				</button>
			</div>
		</div>

		<!-- ติดต่อฉุกเฉินและด่วน -->
		<div class="flex flex-col justify-center rounded-2xl bg-primary-dark p-6 text-white shadow-lg lg:p-8">
			<div class="mb-4 flex items-center gap-3">
				<PhoneCall class="h-6 w-6 text-chart-2" />
				<h2 class="text-xl font-bold">ติดต่อฉุกเฉินและด่วน</h2>
			</div>
			<p class="mb-6 text-sm text-slate-300">
				ต้องการความช่วยเหลือทางการแพทย์ รถยกเคลื่อนย้าย หรือสอบถามข้อมูลเพิ่มเติม
			</p>

			<div class="flex flex-col gap-3">
				<!-- โทร 1669 -->
				<a href="tel:1669" class="flex items-center justify-between rounded-xl bg-danger px-5 py-4 font-bold transition-colors hover:bg-danger/90">
					<div class="flex items-center gap-3">
						<Phone class="h-5 w-5 text-white" />
						<span class="text-white text-base">โทร 1669</span>
					</div>
					<span class="rounded-lg bg-white/20 px-3 py-1.5 text-[11px] text-white">เจ็บป่วยฉุกเฉิน</span>
				</a>
				
				<!-- โทร 1784 -->
				<a href="tel:1784" class="flex items-center justify-between rounded-xl bg-warning px-5 py-4 font-bold transition-colors hover:bg-warning/90">
					<div class="flex items-center gap-3">
						<Phone class="h-5 w-5 text-white" />
						<span class="text-white text-base">โทร 1784</span>
					</div>
					<span class="rounded-lg bg-black/20 px-3 py-1.5 text-[11px] text-white">สายด่วน ปภ.</span>
				</a>

				<div class="mt-2 grid grid-cols-2 gap-3">
					<!-- LINE -->
					<button type="button" class="flex items-center justify-center gap-2 rounded-xl bg-chart-2 py-3.5 text-sm font-bold text-white transition-colors hover:bg-chart-2/90">
						<MessageCircle class="h-4.5 w-4.5" />
						ติดต่อผ่าน LINE
					</button>
					<!-- Facebook -->
					<button type="button" class="flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark">
						<Globe class="h-4.5 w-4.5" />
						ศูนย์เพจ Facebook
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

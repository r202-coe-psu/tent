<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Cpu from '@lucide/svelte/icons/cpu';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Check from '@lucide/svelte/icons/check';
	import Timer from '@lucide/svelte/icons/timer';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
</script>

<svelte:head>
	<title>กำลังอ่านข้อมูลบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-2xl flex-1 flex-col items-center justify-between gap-6 py-2 text-center"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 2 Active) -->
	<!-- ========================================== -->
	<div class="w-full px-2 sm:px-4">
		<div class="relative flex items-start justify-between">
			<!-- Connecting Background Track Lines -->
			<div class="absolute top-5 right-10 left-10 h-1 -translate-y-1/2 bg-slate-300 sm:top-6"></div>
			<!-- Active Progress Line (Filled up to Step 2) -->
			<div class="absolute top-5 left-10 h-1 w-1/2 -translate-y-1/2 bg-blue-600 sm:top-6"></div>

			<!-- Step 1: Completed -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-md ring-4 ring-blue-100 sm:h-12 sm:w-12"
				>
					<Check class="h-5 w-5 stroke-[3]" />
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">เสียบบัตร</p>
					<p class="text-[10px] font-semibold text-blue-600 sm:text-xs">เรียบร้อย</p>
				</div>
			</div>

			<!-- Step 2: Active / Reading -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="relative flex h-10 w-10 items-center justify-center rounded-full bg-cyan-600 font-mono text-sm font-black text-white shadow-lg ring-4 shadow-cyan-500/30 ring-cyan-100 sm:h-12 sm:w-12 sm:text-base"
				>
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"
					></span>
					<span class="relative">2</span>
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-black text-cyan-700 sm:text-sm">กำลังอ่านข้อมูล</p>
					<p
						class="flex items-center justify-center gap-0.5 text-[10px] font-bold text-cyan-600 sm:text-xs"
					>
						<Timer class="h-3 w-3 animate-spin" />
						กำลังประมวลผล
					</p>
				</div>
			</div>

			<!-- Step 3: Pending -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-white font-mono text-sm font-bold text-slate-500 shadow-sm sm:h-12 sm:w-12 sm:text-base"
				>
					3
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">ถอดบัตรออก</p>
					<p
						class="flex items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400 sm:text-xs"
					>
						<CheckCircle2 class="h-3 w-3 text-slate-400" />
						เมื่อขึ้นไฟเขียว
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- ========================================== -->
	<!-- ส่วนที่ 2 (กลาง): Radar Scanning & Typography -->
	<!-- ========================================== -->
	<div class="my-auto flex w-full flex-col items-center">
		<!-- Radar Animation -->
		<div class="relative my-2 flex h-48 w-48 items-center justify-center sm:my-4 sm:h-56 sm:w-56">
			<div
				class="absolute h-full w-full animate-ping rounded-full bg-blue-500/15 duration-1000"
			></div>
			<div
				class="absolute h-44 w-44 animate-spin rounded-full border-4 border-dashed border-blue-300 duration-3000 sm:h-52 sm:w-52"
			></div>
			<div
				class="absolute h-36 w-36 animate-spin rounded-full border-4 border-cyan-400 border-t-blue-600 sm:h-44 sm:w-44"
			></div>

			<!-- Core Circular Visual -->
			<div
				class="relative flex h-24 w-24 items-center justify-center rounded-full border-4 border-blue-400 bg-white shadow-2xl ring-4 shadow-blue-500/20 ring-blue-100 sm:h-32 sm:w-32"
			>
				<CreditCard class="h-12 w-12 text-blue-600 sm:h-16 sm:w-16" />
				<div class="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center">
					<span class="absolute h-full w-full animate-ping rounded-full bg-blue-500 opacity-75"
					></span>
					<span class="relative h-3.5 w-3.5 rounded-full bg-blue-600 shadow-md"></span>
				</div>
			</div>
		</div>

		<!-- Typography & Progress Bar -->
		<div class="mt-2 w-full max-w-lg space-y-2">
			<div
				class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 font-mono text-xs font-black text-blue-700 shadow-sm sm:text-sm"
			>
				<Cpu class="h-4 w-4 animate-spin text-blue-600" />
				<span>SMART CARD READING IN PROGRESS</span>
			</div>

			<h2
				class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl md:text-5xl"
			>
				กำลังอ่านข้อมูลจากบัตร...
			</h2>

			<p class="text-base font-bold text-slate-600 sm:text-lg">
				ระบบกำลังดึงข้อมูลส่วนบุคคลและรูปถ่ายจากชิปสมาร์ทการ์ด
			</p>

			<!-- Scanning Progress Bar -->
			<div class="mt-3 w-full overflow-hidden rounded-full bg-slate-200 p-1 shadow-inner">
				<div class="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
					<div
						class="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-blue-600 to-transparent"
						style="animation: shimmer 1.2s infinite;"
					></div>
				</div>
			</div>
		</div>
	</div>

	<!-- ========================================== -->
	<!-- ส่วนที่ 3 (ล่าง): Urgent Warning & PDPA -->
	<!-- ========================================== -->
	<div class="w-full max-w-xl space-y-3">
		<!-- Critical Warning Callout -->
		<div
			class="flex items-center gap-4 rounded-3xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 p-4 text-left text-amber-950 shadow-md"
		>
			<AlertCircle class="h-7 w-7 shrink-0 text-amber-600" />
			<div>
				<p class="text-base font-black text-amber-900 sm:text-lg">โปรดอย่าเพิ่งดึงบัตรออก</p>
				<p class="text-xs font-semibold text-amber-800 sm:text-sm">
					ระบบกำลังประมวลผลข้อมูล โปรดรอสักครู่ (ประมาณ 1-2 วินาที)
				</p>
			</div>
		</div>

		<!-- PDPA Disclaimer Card -->
		<div
			class="rounded-2xl border border-slate-200 bg-white/90 p-3.5 text-left text-xs text-slate-600 shadow-sm sm:text-sm"
		>
			<div class="flex items-start gap-2.5">
				<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
				<div class="space-y-0.5">
					<p class="font-bold text-slate-900">นโยบายความคุ้มครองข้อมูลส่วนบุคคล (PDPA)</p>
					<p class="text-[11px] leading-relaxed font-medium text-slate-500">
						ข้อมูลส่วนบุคคลนี้จะถูกใช้เพื่อการลงทะเบียนคัดกรอง จัดสรรที่พักพิง และรับสิทธิประโยชน์
					</p>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(200%);
		}
	}
</style>

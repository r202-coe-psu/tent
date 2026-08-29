<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Cpu from '@lucide/svelte/icons/cpu';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Check from '@lucide/svelte/icons/check';
	import Timer from '@lucide/svelte/icons/timer';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
</script>

<svelte:head>
	<title>กำลังอ่านข้อมูลบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-6xl flex-1 flex-col justify-between gap-4 py-2 lg:gap-6 xl:max-w-7xl"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 2 Active) -->
	<!-- ========================================== -->
	<div class="mx-auto w-full max-w-3xl px-2 sm:px-4">
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
	<!-- ส่วนที่ 2 (กลาง): 2-Column Grid สำหรับจอกว้าง Kiosk แนวนอน -->
	<!-- ========================================== -->
	<div
		class="my-auto grid w-full grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-10 xl:gap-14"
	>
		<!-- คอลัมน์ซ้าย: ข้อความสถานะ, Progress bar และคำเตือนห้ามดึงบัตร -->
		<div
			class="flex flex-col items-center space-y-4 text-center lg:col-span-6 lg:items-start lg:text-left xl:col-span-7 xl:space-y-5"
		>
			<div
				class="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 font-mono text-xs font-black text-cyan-800 shadow-sm sm:text-sm"
			>
				<Cpu class="h-4 w-4 animate-spin text-cyan-600" />
				<span>SMART CARD READING IN PROGRESS</span>
			</div>

			<h2
				class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl"
			>
				กำลังอ่านข้อมูลจากบัตร...
			</h2>

			<p class="text-base font-bold text-slate-600 sm:text-lg">
				ระบบกำลังดึงข้อมูลส่วนบุคคลและรูปถ่ายจากชิปสมาร์ทการ์ด
			</p>

			<!-- Scanning Progress Bar -->
			<div class="w-full overflow-hidden rounded-full bg-slate-200 p-1 shadow-inner">
				<div class="relative h-3 w-full overflow-hidden rounded-full bg-slate-200">
					<div
						class="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600"
						style="animation: shimmer 1.2s infinite;"
					></div>
				</div>
			</div>

			<!-- Critical Warning Callout -->
			<div
				class="flex w-full items-center gap-4 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 p-4 text-left text-amber-950 shadow-md"
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
				class="w-full rounded-2xl border border-slate-200 bg-white/90 p-3.5 text-left text-xs text-slate-600 shadow-sm sm:text-sm"
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

		<!-- คอลัมน์ขวา: Radar Animation & Data Stream Checklist -->
		<div class="flex flex-col items-center justify-center space-y-5 lg:col-span-6 xl:col-span-5">
			<!-- Radar Animation -->
			<div class="relative flex h-52 w-52 items-center justify-center sm:h-60 sm:w-60">
				<div
					class="absolute h-full w-full animate-ping rounded-full bg-cyan-500/15 duration-1000"
				></div>
				<div
					class="absolute h-48 w-48 animate-spin rounded-full border-4 border-dashed border-cyan-300 duration-3000 sm:h-56 sm:w-56"
				></div>
				<div
					class="absolute h-40 w-40 animate-spin rounded-full border-4 border-cyan-400 border-t-blue-600 sm:h-48 sm:w-48"
				></div>

				<!-- Core Circular Visual -->
				<div
					class="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-blue-400 bg-white shadow-2xl ring-4 shadow-blue-500/20 ring-blue-100 sm:h-34 sm:w-34"
				>
					<CreditCard class="h-14 w-14 text-blue-600 sm:h-16 sm:w-16" />
					<div class="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center">
						<span class="absolute h-full w-full animate-ping rounded-full bg-cyan-500 opacity-75"
						></span>
						<span class="relative h-3.5 w-3.5 rounded-full bg-cyan-600 shadow-md"></span>
					</div>
				</div>
			</div>

			<!-- Live Reading Checklist -->
			<div
				class="grid w-full max-w-md grid-cols-2 gap-2 text-left text-xs font-bold text-slate-700"
			>
				<div
					class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm"
				>
					<CheckCircle class="h-4 w-4 shrink-0 text-emerald-600" />
					<span class="truncate">เลขประจำตัว 13 หลัก</span>
				</div>
				<div
					class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm"
				>
					<CheckCircle class="h-4 w-4 shrink-0 text-emerald-600" />
					<span class="truncate">ชื่อ - สกุล และเพศ</span>
				</div>
				<div
					class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm"
				>
					<CheckCircle class="h-4 w-4 shrink-0 text-emerald-600" />
					<span class="truncate">ที่อยู่ตามทะเบียนบ้าน</span>
				</div>
				<div
					class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm"
				>
					<CheckCircle class="h-4 w-4 shrink-0 text-emerald-600" />
					<span class="truncate">รูปถ่ายจากบัตร</span>
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

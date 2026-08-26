<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Timer from '@lucide/svelte/icons/timer';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
</script>

<svelte:head>
	<title>กรุณาเสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-2xl flex-1 flex-col items-center justify-between gap-6 py-2 text-center"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 1 Active) -->
	<!-- ========================================== -->
	<div class="w-full px-2 sm:px-4">
		<div class="relative flex items-start justify-between">
			<!-- Connecting Background Track Lines -->
			<div class="absolute top-5 right-10 left-10 h-1 -translate-y-1/2 bg-slate-300 sm:top-6"></div>
			<!-- Active Progress Line (from Step 1 to half) -->
			<div
				class="absolute top-5 left-10 h-1 w-1/2 -translate-y-1/2 bg-gradient-to-r from-blue-600 to-slate-300 sm:top-6"
			></div>

			<!-- Step 1: Current / Active -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-mono text-sm font-black text-white shadow-lg ring-4 shadow-blue-500/30 ring-blue-100 sm:h-12 sm:w-12 sm:text-base"
				>
					1
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-black text-blue-700 sm:text-sm">เสียบบัตร</p>
					<p class="text-[10px] font-semibold text-slate-500 sm:text-xs">หงายชิปทองขึ้น</p>
				</div>
			</div>

			<!-- Step 2: Pending -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-white font-mono text-sm font-bold text-slate-500 shadow-sm sm:h-12 sm:w-12 sm:text-base"
				>
					2
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">รอระบบอ่าน</p>
					<p
						class="flex items-center justify-center gap-0.5 text-[10px] font-medium text-slate-400 sm:text-xs"
					>
						<Timer class="h-3 w-3 text-slate-400" />
						1-2 วินาที
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
	<!-- ส่วนที่ 2 (กลาง): ข้อความหลัก & ป้ายเตือนชิปทอง -->
	<!-- ========================================== -->
	<div class="my-auto flex w-full flex-col items-center space-y-3.5">
		<!-- Primary Headline -->
		<h2
			class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl md:text-5xl"
		>
			กรุณาเสียบบัตรประจำตัวประชาชน
		</h2>

		<!-- Urgent Key Highlight (Gold Chip Up) -->
		<div
			class="inline-flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-5 py-3 text-base font-bold text-amber-950 shadow-md sm:text-lg md:text-xl"
		>
			<Sparkles class="h-6 w-6 shrink-0 text-amber-600" />
			<span>
				เสียบบัตรเข้าเครื่อง โดยหงาย <b
					class="font-black text-amber-700 underline decoration-amber-500 underline-offset-4"
					>ด้านชิปสีทองขึ้น</b
				>
			</span>
		</div>
	</div>

	<!-- ========================================== -->
	<!-- ส่วนที่ 3 (ล่าง): กราฟิกบัตรประชาชน & ช่องเสียบ & สถานะ -->
	<!-- ========================================== -->
	<div class="flex w-full flex-col items-center">
		<!-- Card Graphic -->
		<div
			class="relative flex h-52 w-80 flex-col justify-between overflow-hidden rounded-3xl border-2 border-blue-200/80 bg-gradient-to-br from-white via-sky-50 to-blue-50/80 p-5 shadow-2xl ring-1 shadow-blue-500/15 ring-black/5 backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] sm:h-60 sm:w-96 md:h-68 md:w-[420px]"
		>
			<!-- Top Row: Thai Flag & Official Card Type -->
			<div class="flex items-center justify-between">
				<div class="flex h-3 w-16 overflow-hidden rounded shadow-sm ring-1 ring-black/10">
					<div class="w-1/5 bg-red-600"></div>
					<div class="w-1/5 bg-white"></div>
					<div class="w-1/5 bg-blue-800"></div>
					<div class="w-1/5 bg-white"></div>
					<div class="w-1/5 bg-red-600"></div>
				</div>
				<div
					class="flex items-center gap-1.5 font-mono text-[11px] font-black text-slate-600 sm:text-xs"
				>
					<CreditCard class="h-4 w-4 text-blue-600" />
					<span>บัตรประจำตัวประชาชน THAI ID</span>
				</div>
			</div>

			<!-- Middle Row: Large Gold Smart Chip with Metallic Circuit Lines & Gleam -->
			<div class="my-auto flex items-center gap-5 sm:gap-6">
				<!-- Gold Chip -->
				<div
					class="relative flex h-13 w-17 items-center justify-center rounded-xl border-2 border-amber-300 bg-gradient-to-tr from-amber-400 via-yellow-300 to-amber-100 shadow-lg ring-4 shadow-amber-400/40 ring-amber-300/30 sm:h-16 sm:w-20"
				>
					<!-- Circuit lines -->
					<div class="grid grid-cols-2 grid-rows-2 gap-1.5 opacity-80">
						<div class="h-3 w-5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
						<div class="h-3 w-5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
						<div class="h-3 w-5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
						<div class="h-3 w-5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
					</div>
					<!-- Gleam effect -->
					<span
						class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-200 text-xs shadow-md"
					>
						✨
					</span>
				</div>

				<!-- Mock photo placeholder & ID lines -->
				<div class="flex-1 space-y-2 text-left">
					<div class="h-3.5 w-32 rounded-md bg-slate-300/80"></div>
					<div class="h-2.5 w-40 rounded-md bg-slate-200"></div>
					<div class="h-2.5 w-24 rounded-md bg-slate-200"></div>
				</div>
			</div>

			<!-- Bottom Row: 13 Digits Indicator -->
			<div
				class="flex items-center justify-between border-t border-slate-200 pt-2 font-mono text-[10px] font-bold text-slate-500 sm:text-xs"
			>
				<span>เลขประจำตัวประชาชน 13 หลัก</span>
				<span class="font-extrabold text-blue-600">SMART CARD CHIP</span>
			</div>
		</div>

		<!-- Card Slot Insertion Base with animated bouncing down arrow -->
		<div
			class="relative -mt-4 flex h-14 w-84 items-center justify-center rounded-b-3xl border-2 border-dashed border-blue-400 bg-white/95 px-6 shadow-xl backdrop-blur-md sm:w-96 md:w-[440px]"
		>
			<div class="flex items-center gap-3 text-sm font-extrabold text-blue-700 sm:text-base">
				<div
					class="flex h-9 w-9 animate-bounce items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/40"
				>
					<ArrowDown class="h-5 w-5 stroke-[3]" />
				</div>
				<span>ช่องเสียบบัตร Smart Card Reader</span>
			</div>
		</div>

		<!-- Status Pulse Indicator -->
		<div
			class="mt-4 flex items-center gap-2.5 font-mono text-sm font-bold text-slate-600 sm:text-base"
		>
			<span class="relative flex h-3 w-3">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75"
				></span>
				<span class="relative inline-flex h-3 w-3 rounded-full bg-blue-600"></span>
			</span>
			<span>กำลังรอการเสียบบัตรประชาชน...</span>
		</div>
	</div>
</div>

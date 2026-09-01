<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Timer from '@lucide/svelte/icons/timer';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Zap from '@lucide/svelte/icons/zap';
</script>

<svelte:head>
	<title>กรุณาเสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-6xl flex-1 flex-col justify-between gap-4 py-2 lg:gap-6 xl:max-w-7xl"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 1 Active) -->
	<!-- ========================================== -->
	<div class="mx-auto w-full max-w-3xl px-2 sm:px-4">
		<div class="relative flex items-start justify-between">
			<!-- Connecting Background Track Lines -->
			<div
				class="absolute top-5 right-14 left-14 h-1 -translate-y-1/2 bg-slate-300 sm:top-6 sm:right-16 sm:left-16"
			></div>

			<!-- Step 1: Current / Active -->
			<div class="relative z-10 flex w-28 flex-col items-center sm:w-32">
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
			<div class="relative z-10 flex w-28 flex-col items-center sm:w-32">
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
			<div class="relative z-10 flex w-28 flex-col items-center sm:w-32">
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
		<!-- คอลัมน์ซ้าย: ข้อความคำแนะนำ หัวข้อเด่น และขั้นตอนย่อย -->
		<div
			class="flex flex-col items-center space-y-4 text-center lg:col-span-6 lg:items-start lg:text-left xl:col-span-7 xl:space-y-5"
		>
			<div
				class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 font-mono text-xs font-black text-blue-700 shadow-sm sm:text-sm"
			>
				<Zap class="h-4 w-4 text-blue-600" />
				<span>จุดบริการสแกนบัตรด่วน (Fast-Track Kiosk)</span>
			</div>

			<!-- Primary Headline -->
			<h2
				class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl xl:text-5xl"
			>
				กรุณาเสียบบัตรประจำตัวประชาชน
			</h2>

			<!-- Urgent Key Highlight (Gold Chip Up) -->
			<div
				class="w-full rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 p-4 text-amber-950 shadow-md sm:p-5"
			>
				<div class="flex items-start gap-3">
					<Sparkles class="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
					<div class="space-y-1">
						<p class="text-base font-black sm:text-lg lg:text-xl">
							เสียบบัตรเข้าเครื่อง โดยหงาย <span
								class="text-amber-700 underline decoration-amber-500 underline-offset-4"
								>ด้านชิปสีทองขึ้น</span
							>
						</p>
						<p class="text-xs font-semibold text-amber-900/80 sm:text-sm">
							ให้ด้านที่มีชิปการ์ดเข้าหาตัวเครื่องอ่าน
						</p>
					</div>
				</div>
			</div>

			<!-- Quick Step Instructions Card List -->
			<div class="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-3 lg:gap-3">
				<div
					class="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white/90 p-3 text-left shadow-sm"
				>
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 font-mono text-xs font-black text-blue-700"
					>
						1
					</div>
					<p class="text-xs font-bold text-slate-700">หงายชิปสีทองขึ้น</p>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white/90 p-3 text-left shadow-sm"
				>
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 font-mono text-xs font-black text-blue-700"
					>
						2
					</div>
					<p class="text-xs font-bold text-slate-700">เสียบเข้าช่องให้สุด</p>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white/90 p-3 text-left shadow-sm"
				>
					<div
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 font-mono text-xs font-black text-blue-700"
					>
						3
					</div>
					<p class="text-xs font-bold text-slate-700">รอระบบอ่าน 1-2 วิ</p>
				</div>
			</div>

			<!-- Status Pulse Indicator -->
			<div
				class="flex items-center gap-2.5 pt-1 font-mono text-sm font-bold text-slate-600 sm:text-base"
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

		<!-- คอลัมน์ขวา: กราฟิกบัตรประชาชนขนาดใหญ่ & ช่องเสียบบัตร -->
		<div class="flex flex-col items-center justify-center lg:col-span-6 xl:col-span-5">
			<!-- Card Graphic -->
			<div
				class="relative flex h-56 w-84 flex-col justify-between overflow-hidden rounded-3xl border-2 border-blue-200/80 bg-gradient-to-br from-white via-sky-50 to-blue-50/80 p-5 shadow-2xl ring-1 shadow-blue-500/15 ring-black/5 backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] sm:h-64 sm:w-96 md:h-72 md:w-[420px] lg:h-76 lg:w-[440px]"
			>
				<!-- Top Row: Thai Flag & Official Card Type -->
				<div class="flex items-center justify-between">
					<div class="flex h-3.5 w-16 overflow-hidden rounded shadow-sm ring-1 ring-black/10">
						<div class="w-1/5 bg-red-600"></div>
						<div class="w-1/5 bg-white"></div>
						<div class="w-1/5 bg-blue-800"></div>
						<div class="w-1/5 bg-white"></div>
						<div class="w-1/5 bg-red-600"></div>
					</div>
					<div
						class="flex items-center gap-1.5 font-mono text-xs font-black text-slate-600 sm:text-sm"
					>
						<CreditCard class="h-4 w-4 text-blue-600" />
						<span>บัตรประจำตัวประชาชน THAI ID</span>
					</div>
				</div>

				<!-- Middle Row: Large Gold Smart Chip with Metallic Circuit Lines & Gleam -->
				<div class="my-auto flex items-center gap-5 sm:gap-6">
					<!-- Gold Chip -->
					<div
						class="relative flex h-14 w-18 items-center justify-center rounded-xl border-2 border-amber-300 bg-gradient-to-tr from-amber-400 via-yellow-300 to-amber-100 shadow-lg ring-4 shadow-amber-400/40 ring-amber-300/30 sm:h-18 sm:w-22"
					>
						<!-- Circuit lines -->
						<div class="grid grid-cols-2 grid-rows-2 gap-1.5 opacity-80">
							<div class="h-3.5 w-5.5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
							<div class="h-3.5 w-5.5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
							<div class="h-3.5 w-5.5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
							<div class="h-3.5 w-5.5 rounded-sm border border-amber-700/60 bg-amber-600/30"></div>
						</div>
						<!-- Gleam effect -->
						<span
							class="absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-200 text-xs shadow-md"
						>
							✨
						</span>
					</div>

					<!-- Mock photo placeholder & ID lines -->
					<div class="flex-1 space-y-2.5 text-left">
						<div class="h-4 w-36 rounded-md bg-slate-300/80"></div>
						<div class="h-3 w-44 rounded-md bg-slate-200"></div>
						<div class="h-3 w-28 rounded-md bg-slate-200"></div>
					</div>
				</div>

				<!-- Bottom Row: 13 Digits Indicator -->
				<div
					class="flex items-center justify-between border-t border-slate-200 pt-2.5 font-mono text-xs font-bold text-slate-500"
				>
					<span>เลขประจำตัวประชาชน 13 หลัก</span>
					<span class="font-extrabold text-blue-600">SMART CARD CHIP</span>
				</div>
			</div>

			<!-- Card Slot Insertion Base with animated bouncing down arrow -->
			<div
				class="relative -mt-4 flex h-14 w-88 items-center justify-center rounded-b-3xl border-2 border-dashed border-blue-400 bg-white/95 px-6 shadow-xl backdrop-blur-md sm:w-100 md:w-[450px] lg:w-[460px]"
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
		</div>
	</div>
</div>

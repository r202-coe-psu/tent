<script lang="ts">
	import { page } from '$app/state';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Send from '@lucide/svelte/icons/send';
	import Check from '@lucide/svelte/icons/check';

	const message = $derived(
		page.url.searchParams.get('message') ||
			'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล'
	);
</script>

<svelte:head>
	<title>อ่านข้อมูลสำเร็จ — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-2xl flex-1 flex-col items-center justify-between gap-6 py-2 text-center"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 3 Active) -->
	<!-- ========================================== -->
	<div class="w-full px-2 sm:px-4">
		<div class="relative flex items-start justify-between">
			<!-- Connecting Background Track Lines -->
			<div
				class="absolute top-5 right-10 left-10 h-1 -translate-y-1/2 bg-emerald-500 sm:top-6"
			></div>

			<!-- Step 1: Completed -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md ring-4 ring-emerald-100 sm:h-12 sm:w-12"
				>
					<Check class="h-5 w-5 stroke-[3]" />
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">เสียบบัตร</p>
					<p class="text-[10px] font-semibold text-emerald-600 sm:text-xs">สำเร็จ</p>
				</div>
			</div>

			<!-- Step 2: Completed -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md ring-4 ring-emerald-100 sm:h-12 sm:w-12"
				>
					<Check class="h-5 w-5 stroke-[3]" />
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">อ่านข้อมูล</p>
					<p class="text-[10px] font-semibold text-emerald-600 sm:text-xs">สำเร็จ</p>
				</div>
			</div>

			<!-- Step 3: Active / Remove Card -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 font-mono text-sm font-black text-white shadow-lg ring-4 shadow-emerald-500/30 ring-emerald-200 sm:h-12 sm:w-12 sm:text-base"
				>
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative">3</span>
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-black text-emerald-700 sm:text-sm">ถอดบัตรออก</p>
					<p class="text-[10px] font-bold text-emerald-600 sm:text-xs">พร้อมดึงออก</p>
				</div>
			</div>
		</div>
	</div>

	<!-- ========================================== -->
	<!-- ส่วนที่ 2 (กลาง): Success Visual & Typography -->
	<!-- ========================================== -->
	<div class="my-auto flex w-full flex-col items-center space-y-4">
		<!-- Emerald Success Orb -->
		<div
			class="relative flex h-36 w-36 items-center justify-center sm:h-44 sm:w-44 md:h-48 md:w-48"
		>
			<div
				class="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20 duration-1000"
			></div>
			<div
				class="absolute h-32 w-32 rounded-full border-4 border-emerald-300 bg-emerald-50 shadow-inner sm:h-38 sm:w-38 md:h-42 md:w-42"
			></div>
			<div
				class="relative flex h-24 w-24 items-center justify-center rounded-3xl border-2 border-emerald-400 bg-white shadow-2xl ring-4 shadow-emerald-500/25 ring-emerald-100 sm:h-28 sm:w-28 md:h-32 md:w-32"
			>
				<CheckCircle2 class="h-14 w-14 text-emerald-600 sm:h-18 sm:w-18" />
			</div>
		</div>

		<div class="space-y-2">
			<div
				class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-1.5 text-xs font-black text-emerald-700 shadow-sm sm:text-sm"
			>
				<Sparkles class="h-4 w-4" />
				<span>SUCCESSFULLY SCANNED</span>
			</div>

			<h2
				class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl md:text-5xl"
			>
				สแกนข้อมูลสำเร็จเรียบร้อย!
			</h2>
			<p class="mt-1 text-base font-bold text-emerald-800 sm:text-lg">
				{message}
			</p>
		</div>
	</div>

	<!-- ========================================== -->
	<!-- ส่วนที่ 3 (ล่าง): Urgent Remove Card Banner & Info -->
	<!-- ========================================== -->
	<div class="w-full max-w-xl space-y-4">
		<!-- Urgent Action Callout -->
		<div
			class="flex items-center justify-center gap-4 rounded-3xl border-2 border-emerald-600 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 p-5 text-white shadow-2xl shadow-emerald-600/30 transition-transform hover:scale-[1.02] sm:gap-6"
		>
			<div
				class="flex h-12 w-12 shrink-0 animate-bounce items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-lg sm:h-14 sm:w-14"
			>
				<ArrowUp class="h-7 w-7 stroke-[3] sm:h-8 sm:w-8" />
			</div>
			<div class="text-left">
				<p class="text-xl font-black tracking-tight sm:text-2xl md:text-3xl">
					กรุณาถอดบัตรประชาชนออก
				</p>
				<p class="text-xs font-semibold text-emerald-100 sm:text-sm">
					ดึงบัตรออกจากเครื่องอ่านได้เลยครับ
				</p>
			</div>
		</div>

		<!-- Info Card -->
		<div
			class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left text-xs text-slate-700 shadow-sm sm:text-sm"
		>
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600"
			>
				<Send class="h-4 w-4" />
			</div>
			<div class="space-y-0.5">
				<p class="font-black text-slate-900">ข้อมูลเข้าสู่ระบบเจ้าหน้าที่แล้ว</p>
				<p class="text-[11px] leading-relaxed font-medium text-slate-500 sm:text-xs">
					เมื่อท่านถอดบัตรออก หน้าจอจะรีเซ็ตอัตโนมัติเพื่อรอรับผู้ใช้บริการท่านถัดไป
				</p>
			</div>
		</div>
	</div>
</div>

<script lang="ts">
	import { page } from '$app/state';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Send from '@lucide/svelte/icons/send';
	import Check from '@lucide/svelte/icons/check';
	import UserCheck from '@lucide/svelte/icons/user-check';

	const type = $derived(page.url.searchParams.get('type') || '');
	const message = $derived(
		page.url.searchParams.get('message') ||
			(type === 'warning'
				? 'ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว กรุณาไปพบเจ้าหน้าที่'
				: 'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล')
	);

	const isWarning = $derived(
		type === 'warning' ||
			message.includes('เคยเสียบบัตร') ||
			message.includes('สแกนบัตรนี้รออยู่แล้ว') ||
			message.includes('มีข้อมูลในระบบแล้ว') ||
			message.includes('เช็คอิน') ||
			message.includes('ออกชั่วคราว') ||
			message.includes('ประวัติ') ||
			page.url.searchParams.get('status') === 'duplicate_draft'
	);
</script>

<svelte:head>
	<title
		>{isWarning
			? 'เคยบันทึกข้อมูลแล้ว — SmartShelter Kiosk'
			: 'อ่านข้อมูลสำเร็จ — SmartShelter Kiosk'}</title
	>
</svelte:head>

<div
	class="flex h-full w-full max-w-6xl flex-1 flex-col justify-between gap-4 py-2 lg:gap-6 xl:max-w-7xl"
>
	<!-- ========================================== -->
	<!-- ส่วนที่ 1 (บน): Wizard Step UI กลม เชื่อมเส้น (Step 3 Active) -->
	<!-- ========================================== -->
	<div class="mx-auto w-full max-w-3xl px-2 sm:px-4">
		<div class="relative flex items-start justify-between">
			<!-- Connecting Background Track Lines -->
			<div
				class="absolute top-5 right-10 left-10 h-1 -translate-y-1/2 {isWarning
					? 'bg-amber-400'
					: 'bg-emerald-500'} sm:top-6"
			></div>

			<!-- Step 1: Completed -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full {isWarning
						? 'bg-amber-500 ring-amber-100'
						: 'bg-emerald-600 ring-emerald-100'} text-white shadow-md ring-4 sm:h-12 sm:w-12"
				>
					<Check class="h-5 w-5 stroke-[3]" />
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">เสียบบัตร</p>
					<p
						class="text-[10px] font-semibold {isWarning
							? 'text-amber-600'
							: 'text-emerald-600'} sm:text-xs"
					>
						สำเร็จ
					</p>
				</div>
			</div>

			<!-- Step 2: Completed -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full {isWarning
						? 'bg-amber-500 ring-amber-100'
						: 'bg-emerald-600 ring-emerald-100'} text-white shadow-md ring-4 sm:h-12 sm:w-12"
				>
					<Check class="h-5 w-5 stroke-[3]" />
				</div>
				<div class="mt-2 text-center">
					<p class="text-xs font-bold text-slate-700 sm:text-sm">ตรวจข้อมูล</p>
					<p
						class="text-[10px] font-semibold {isWarning
							? 'text-amber-600'
							: 'text-emerald-600'} sm:text-xs"
					>
						{isWarning ? 'พบข้อมูลเดิม' : 'สำเร็จ'}
					</p>
				</div>
			</div>

			<!-- Step 3: Active / Remove Card -->
			<div class="relative z-10 flex flex-col items-center">
				<div
					class="relative flex h-10 w-10 items-center justify-center rounded-full {isWarning
						? 'bg-amber-500 shadow-amber-500/30 ring-amber-200'
						: 'bg-emerald-600 shadow-emerald-500/30 ring-emerald-200'} font-mono text-sm font-black text-white shadow-lg ring-4 sm:h-12 sm:w-12 sm:text-base"
				>
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full {isWarning
							? 'bg-amber-400'
							: 'bg-emerald-400'} opacity-75"
					></span>
					<span class="relative">3</span>
				</div>
				<div class="mt-2 text-center">
					<p
						class="text-xs font-black {isWarning
							? 'text-amber-700'
							: 'text-emerald-700'} sm:text-sm"
					>
						ถอดบัตรออก
					</p>
					<p
						class="text-[10px] font-bold {isWarning
							? 'text-amber-600'
							: 'text-emerald-600'} sm:text-xs"
					>
						พร้อมดึงออก
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
		<!-- คอลัมน์ซ้าย: ข้อความผลลัพธ์ ข้อมูลแจ้งเตือน และคำแนะนำการไปพบเจ้าหน้าที่ -->
		<div
			class="flex flex-col items-center space-y-4 text-center lg:col-span-6 lg:items-start lg:text-left xl:col-span-7 xl:space-y-5"
		>
			{#if isWarning}
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-black text-amber-800 shadow-sm sm:text-sm"
				>
					<UserCheck class="h-4 w-4" />
					<span>ALREADY SCANNED / เคยบันทึกแล้ว</span>
				</div>

				<h2
					class="text-3xl leading-tight font-black tracking-tight text-amber-950 sm:text-4xl lg:text-5xl"
				>
					{message.includes('เสียชีวิต') ? 'ไม่สามารถทำรายการได้' : 'พบข้อมูลของท่านในระบบแล้ว'}
				</h2>

				<p class="text-base font-bold text-amber-800 sm:text-lg">
					{message}
				</p>
			{:else}
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-1.5 text-xs font-black text-emerald-700 shadow-sm sm:text-sm"
				>
					<Sparkles class="h-4 w-4" />
					<span>SUCCESSFULLY SCANNED</span>
				</div>

				<h2
					class="text-3xl leading-tight font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl"
				>
					สแกนข้อมูลสำเร็จเรียบร้อย!
				</h2>

				<p class="text-base font-bold text-emerald-800 sm:text-lg">
					{message}
				</p>
			{/if}

			<!-- Info Card -->
			<div
				class="w-full rounded-2xl border {isWarning
					? 'border-amber-200 bg-amber-50/70'
					: 'border-slate-200 bg-white/90'} p-4 text-left text-xs text-slate-700 shadow-sm sm:text-sm"
			>
				<div class="flex items-start gap-3">
					<div
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl {isWarning
							? 'bg-amber-100 text-amber-700'
							: 'bg-blue-100 text-blue-600'}"
					>
						<Send class="h-5 w-5" />
					</div>
					<div class="space-y-1">
						<p class="text-sm font-black text-slate-900 sm:text-base">
							{isWarning ? 'ข้อมูลของท่านพร้อมในระบบแล้ว' : 'ข้อมูลเข้าสู่ระบบเจ้าหน้าที่แล้ว'}
						</p>
						<p class="text-xs leading-relaxed font-medium text-slate-500 sm:text-sm">
							เมื่อท่านถอดบัตรออก หน้าจอจะรีเซ็ตอัตโนมัติเพื่อรอรับผู้ใช้บริการท่านถัดไป
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- คอลัมน์ขวา: ป้ายแจ้งเตือนให้ถอดบัตรออกขนาดใหญ่ & ไอคอน Pulse -->
		<div class="flex flex-col items-center justify-center space-y-5 lg:col-span-6 xl:col-span-5">
			<!-- Status Pulse Visual -->
			<div class="relative flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
				{#if isWarning}
					<div
						class="absolute h-full w-full animate-ping rounded-full bg-amber-400/20 duration-1000"
					></div>
					<div
						class="absolute h-40 w-40 animate-spin rounded-full border-2 border-dashed border-amber-300 duration-3000 sm:h-46 sm:w-46"
					></div>
					<div
						class="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-amber-400 bg-white text-amber-500 shadow-2xl ring-4 shadow-amber-500/25 ring-amber-100 sm:h-32 sm:w-32"
					>
						<AlertTriangle class="h-14 w-14 stroke-[2.5] sm:h-16 sm:w-16" />
					</div>
				{:else}
					<div
						class="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20 duration-1000"
					></div>
					<div
						class="absolute h-40 w-40 animate-spin rounded-full border-2 border-dashed border-emerald-300 duration-3000 sm:h-46 sm:w-46"
					></div>
					<div
						class="relative flex h-28 w-28 items-center justify-center rounded-full border-4 border-emerald-500 bg-white text-emerald-600 shadow-2xl ring-4 shadow-emerald-500/25 ring-emerald-100 sm:h-32 sm:w-32"
					>
						<CheckCircle2 class="h-14 w-14 stroke-[2.5] sm:h-16 sm:w-16" />
					</div>
				{/if}
			</div>

			<!-- Urgent Remove Card Callout Action Button -->
			{#if isWarning}
				<div
					class="flex w-full max-w-md items-center justify-center gap-4 rounded-3xl border-2 border-amber-500 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 p-5 text-slate-950 shadow-2xl shadow-amber-500/30 transition-transform hover:scale-[1.02] sm:gap-5"
				>
					<div
						class="flex h-12 w-12 shrink-0 animate-bounce items-center justify-center rounded-2xl bg-slate-950 text-amber-400 shadow-lg sm:h-14 sm:w-14"
					>
						<ArrowUp class="h-7 w-7 stroke-[3] sm:h-8 sm:w-8" />
					</div>
					<div class="text-left">
						<p class="text-xl font-black tracking-tight sm:text-2xl">กรุณาถอดบัตรประชาชนออก</p>
						<p class="text-xs font-bold text-amber-950 sm:text-sm">
							ดึงบัตรออกและไปพบเจ้าหน้าที่จุดรับเข้าได้เลยครับ
						</p>
					</div>
				</div>
			{:else}
				<div
					class="flex w-full max-w-md items-center justify-center gap-4 rounded-3xl border-2 border-emerald-600 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 p-5 text-white shadow-2xl shadow-emerald-600/30 transition-transform hover:scale-[1.02] sm:gap-5"
				>
					<div
						class="flex h-12 w-12 shrink-0 animate-bounce items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-lg sm:h-14 sm:w-14"
					>
						<ArrowUp class="h-7 w-7 stroke-[3] sm:h-8 sm:w-8" />
					</div>
					<div class="text-left">
						<p class="text-xl font-black tracking-tight sm:text-2xl">กรุณาถอดบัตรประชาชนออก</p>
						<p class="text-xs font-semibold text-emerald-100 sm:text-sm">
							ดึงบัตรออกจากเครื่องอ่านได้เลยครับ
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import UserCheck from '@lucide/svelte/icons/user-check';

	const errorMsg = $derived(
		page.url.searchParams.get('error_msg') ||
			'ไม่สามารถอ่านข้อมูลจากบัตรได้ โปรดตรวจสอบการเสียบบัตร'
	);
</script>

<svelte:head>
	<title>เกิดข้อผิดพลาด — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-3xl flex-1 flex-col items-center justify-between py-4 text-center"
>
	<!-- Top: Large Error Shield Graphic -->
	<div
		class="relative my-4 flex h-44 w-44 items-center justify-center sm:my-6 sm:h-56 sm:w-56 md:h-64 md:w-64"
	>
		<!-- Outer pulse -->
		<div
			class="absolute h-full w-full animate-ping rounded-full bg-rose-500/15 duration-1000"
		></div>

		<!-- Central Error Shield -->
		<div
			class="flex h-28 w-28 items-center justify-center rounded-full border-4 border-rose-400 bg-white shadow-2xl ring-4 shadow-rose-500/25 ring-rose-100 sm:h-36 sm:w-36 md:h-44 md:w-44"
		>
			<AlertOctagon class="h-14 w-14 text-rose-600 sm:h-18 sm:w-18 md:h-22 md:w-22" />
		</div>
	</div>

	<!-- Middle: Large Error Headline & Message Banner -->
	<div class="w-full max-w-xl space-y-4">
		<h2
			class="text-3xl leading-tight font-black tracking-tight text-rose-600 sm:text-4xl md:text-5xl"
		>
			ไม่สามารถอ่านข้อมูลบัตรได้
		</h2>
		<div
			class="rounded-2xl border-2 border-rose-200 bg-rose-50 px-5 py-3 text-sm font-bold text-rose-800 shadow-sm sm:text-base"
		>
			{errorMsg}
		</div>
	</div>

	<!-- Bottom: 3 Steps Action Guide -->
	<div class="mt-6 w-full max-w-xl space-y-3 text-left">
		<div
			class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm"
		>
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-2 ring-amber-300/40"
			>
				<ArrowUp class="h-5 w-5 sm:h-6 sm:w-6" />
			</div>
			<div>
				<p class="text-base font-black text-slate-900 sm:text-lg">1. ดึงบัตรประชาชนออก</p>
				<p class="text-xs font-medium text-slate-500 sm:text-sm">
					นำบัตรออกจากเครื่องอ่านเพื่อเตรียมเสียบใหม่อีกครั้ง
				</p>
			</div>
		</div>

		<div
			class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm"
		>
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 ring-2 ring-blue-300/40"
			>
				<RotateCcw class="h-5 w-5 sm:h-6 sm:w-6" />
			</div>
			<div>
				<p class="text-base font-black text-slate-900 sm:text-lg">
					2. เสียบใหม่อีกครั้ง โดยหงายชิปสีทองขึ้น
				</p>
				<p class="text-xs font-medium text-slate-500 sm:text-sm">
					ตรวจสอบให้แน่ใจว่าหน้าสัมผัสชิปสะอาดและเสียบเข้าจนสุดช่อง
				</p>
			</div>
		</div>

		<div
			class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm"
		>
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700 ring-2 ring-cyan-300/40"
			>
				<UserCheck class="h-5 w-5 sm:h-6 sm:w-6" />
			</div>
			<div>
				<p class="text-base font-black text-slate-900 sm:text-lg">
					3. หากยังพบปัญหา โปรดติดต่อเจ้าหน้าที่
				</p>
				<p class="text-xs font-medium text-slate-500 sm:text-sm">
					เจ้าหน้าที่ประจำศูนย์พักพิงสามารถกรอกข้อมูลลงทะเบียนให้ท่านได้โดยตรง
				</p>
			</div>
		</div>
	</div>
</div>

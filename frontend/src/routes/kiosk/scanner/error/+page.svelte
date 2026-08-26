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

<div class="flex w-full max-w-2xl flex-col items-center text-center">
	<!-- Error Icon with Alert Glow -->
	<div class="relative my-4 flex h-36 w-36 items-center justify-center sm:my-6 sm:h-44 sm:w-44">
		<!-- Outer pulse -->
		<div
			class="absolute h-full w-full animate-ping rounded-full bg-rose-500/15 duration-1000"
		></div>

		<!-- Central Error Shield -->
		<div
			class="flex h-24 w-24 items-center justify-center rounded-3xl border-2 border-rose-500/40 bg-gradient-to-tr from-rose-950 to-slate-900 shadow-2xl ring-2 shadow-rose-500/30 ring-rose-400/30 sm:h-28 sm:w-28"
		>
			<AlertOctagon class="h-12 w-12 text-rose-500 sm:h-14 sm:w-14" />
		</div>
	</div>

	<!-- Error Headlines -->
	<div class="max-w-md space-y-2">
		<h2 class="text-2xl font-black tracking-tight text-rose-400 sm:text-3xl lg:text-4xl">
			ไม่สามารถอ่านข้อมูลบัตรได้
		</h2>
		<div
			class="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-200 sm:text-sm"
		>
			{errorMsg}
		</div>
	</div>

	<!-- Action Step Guide -->
	<div class="mt-6 w-full max-w-lg space-y-2.5 text-left text-xs sm:text-sm">
		<div
			class="flex items-start gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-3.5 shadow-sm sm:p-4"
		>
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-400/30 sm:h-9 sm:w-9"
			>
				<ArrowUp class="h-4 w-4 sm:h-5 sm:w-5" />
			</div>
			<div>
				<p class="font-bold text-slate-200">1. ดึงบัตรประชาชนออก</p>
				<p class="mt-0.5 text-xs text-slate-400">นำบัตรออกจากเครื่องเพื่อเตรียมเสียบใหม่อีกครั้ง</p>
			</div>
		</div>

		<div
			class="flex items-start gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-3.5 shadow-sm sm:p-4"
		>
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-400/30 sm:h-9 sm:w-9"
			>
				<RotateCcw class="h-4 w-4 sm:h-5 sm:w-5" />
			</div>
			<div>
				<p class="font-bold text-slate-200">2. เสียบใหม่อีกครั้ง โดยหงายชิปสีทองขึ้น</p>
				<p class="mt-0.5 text-xs text-slate-400">
					ตรวจสอบให้แน่ใจว่าหน้าสัมผัสชิปสะอาดและเสียบเข้าจนสุด
				</p>
			</div>
		</div>

		<div
			class="flex items-start gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-3.5 shadow-sm sm:p-4"
		>
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 ring-1 ring-blue-400/30 sm:h-9 sm:w-9"
			>
				<UserCheck class="h-4 w-4 sm:h-5 sm:w-5" />
			</div>
			<div>
				<p class="font-bold text-slate-200">3. หากยังพบปัญหา ติดต่อเจ้าหน้าที่</p>
				<p class="mt-0.5 text-xs text-slate-400">
					เจ้าหน้าที่ประจำศูนย์สามารถกรอกข้อมูลลงทะเบียนให้ท่านได้โดยตรง
				</p>
			</div>
		</div>
	</div>
</div>

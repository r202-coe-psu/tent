<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Send from '@lucide/svelte/icons/send';
</script>

<svelte:head>
	<title>อ่านข้อมูลสำเร็จ — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex w-full max-w-2xl flex-col items-center text-center">
	<!-- Success Glowing Orb Visual -->
	<div class="relative my-4 flex h-40 w-40 items-center justify-center sm:my-6 sm:h-48 sm:w-48">
		<!-- Outer emerald pulse -->
		<div
			class="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20 duration-1000"
		></div>

		<!-- Middle ring -->
		<div
			class="absolute h-32 w-32 rounded-full border-2 border-emerald-400/30 bg-emerald-500/10 sm:h-40 sm:w-40"
		></div>

		<!-- Central Success Icon -->
		<div
			class="flex h-24 w-24 items-center justify-center rounded-3xl border-2 border-emerald-400/60 bg-gradient-to-tr from-emerald-950 to-slate-900 shadow-2xl ring-2 shadow-emerald-500/30 ring-emerald-400/40 sm:h-28 sm:w-28"
		>
			<CheckCircle2 class="h-12 w-12 text-emerald-400 sm:h-16 sm:w-16" />
		</div>
	</div>

	<!-- Main Success Message -->
	<div class="max-w-lg space-y-3">
		<div
			class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-400"
		>
			<Sparkles class="h-3.5 w-3.5" />
			<span>SUCCESSFULLY SCANNED</span>
		</div>

		<h2 class="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
			สแกนข้อมูลสำเร็จเรียบร้อย
		</h2>

		<!-- Urgent Action Banner: REMOVE CARD -->
		<div
			class="mt-4 flex items-center justify-center gap-4 rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-r from-emerald-900/60 via-emerald-800/40 to-emerald-900/60 p-4 shadow-lg shadow-emerald-500/20 sm:p-5"
		>
			<div
				class="flex h-11 w-11 shrink-0 animate-bounce items-center justify-center rounded-full bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/50 sm:h-12 sm:w-12"
			>
				<ArrowUp class="h-6 w-6 stroke-[3] sm:h-7 sm:w-7" />
			</div>
			<div class="text-left">
				<p class="text-lg font-black text-white sm:text-xl">กรุณาถอดบัตรประชาชนออก</p>
				<p class="text-xs font-medium text-emerald-200 sm:text-sm">
					ดึงบัตรออกจากเครื่องอ่านได้เลยครับ
				</p>
			</div>
		</div>
	</div>

	<!-- Informative Next Steps Card -->
	<div
		class="mt-6 flex w-full max-w-lg items-start gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 text-left text-xs text-slate-300 shadow-sm"
	>
		<Send class="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
		<div class="space-y-1">
			<p class="font-bold text-slate-200">ข้อมูลเข้าสู่ระบบเจ้าหน้าที่แล้ว</p>
			<p class="text-[11px] leading-relaxed text-slate-400 sm:text-xs">
				เจ้าหน้าที่ประจำจุดบริการสามารถดึงข้อมูลของท่านเพื่อดำเนินการต่อได้ทันที
				เมื่อถอดบัตรออกหน้าจอจะรีเซ็ตอัตโนมัติ
			</p>
		</div>
	</div>
</div>

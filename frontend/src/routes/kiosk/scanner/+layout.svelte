<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tent from '@lucide/svelte/icons/tent';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Cpu from '@lucide/svelte/icons/cpu';

	let { children }: { children: Snippet } = $props();

	let now = $state(new Date());
	$effect(() => {
		const timer = setInterval(() => {
			now = new Date();
		}, 1000);
		return () => clearInterval(timer);
	});

	const timeString = $derived(
		now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
	);
	const dateString = $derived(
		now.toLocaleDateString('th-TH', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})
	);
</script>

<div
	class="relative flex min-h-screen w-full flex-col justify-between overflow-x-hidden bg-slate-100 pb-[var(--testing-banner-height)] font-sans text-slate-900 selection:bg-blue-600 selection:text-white"
>
	<!-- Ambient bright gradient backgrounds for light white tone -->
	<div
		class="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[140px]"
	></div>
	<div
		class="pointer-events-none absolute top-1/3 -left-40 h-[450px] w-[450px] rounded-full bg-blue-500/10 blur-[140px]"
	></div>
	<div
		class="pointer-events-none absolute -right-40 bottom-10 h-[500px] w-[500px] rounded-full bg-indigo-400/10 blur-[150px]"
	></div>

	<!-- Top Header (Clean White / Light Theme, Big Typography) -->
	<header
		class="relative z-10 flex shrink-0 flex-col gap-3 border-b border-slate-200/90 bg-white/95 px-5 py-4 shadow-sm backdrop-blur-md sm:px-8 sm:py-5 md:flex-row md:items-center md:justify-between"
	>
		<!-- Brand & Station Identity -->
		<div class="flex items-center justify-between md:justify-start md:gap-5">
			<div class="flex items-center gap-3.5 sm:gap-4">
				<div
					class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 shadow-md ring-2 shadow-blue-500/25 ring-white sm:h-14 sm:w-14"
				>
					<Tent class="h-7 w-7 text-white sm:h-8 sm:w-8" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
							SmartShelter
						</h1>
						<span
							class="rounded-lg bg-blue-100 px-2 py-0.5 text-xs font-black text-blue-700 ring-1 ring-blue-300/50"
							>KIOSK</span
						>
					</div>
					<p class="text-xs font-semibold text-slate-500 sm:text-sm">
						จุดบริการสแกนบัตรประชาชน (Smart Card Station)
					</p>
				</div>
			</div>

			<!-- Mobile Ready Badge -->
			<div
				class="flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-700 shadow-sm md:hidden"
			>
				<span class="relative flex h-2.5 w-2.5">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
				</span>
				<span>พร้อมทำงาน</span>
			</div>
		</div>

		<!-- Clock & Desktop Status Badge -->
		<div class="flex items-center justify-between gap-4 md:justify-end">
			<div
				class="flex flex-1 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 font-mono text-xs shadow-inner sm:px-5 sm:py-2.5 sm:text-sm md:flex-initial"
			>
				<div class="flex items-center gap-2 text-slate-500">
					<Cpu class="h-4 w-4 text-blue-600" />
					<span class="hidden text-xs font-bold sm:inline">Kiosk Station</span>
				</div>
				<div class="flex items-center gap-3">
					<span class="font-sans text-xs font-semibold text-slate-600 sm:text-sm">{dateString}</span
					>
					<span class="text-sm font-black tracking-wider text-blue-600 sm:text-base"
						>{timeString}</span
					>
				</div>
			</div>

			<!-- Desktop Ready Badge -->
			<div
				class="hidden items-center gap-2.5 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-extrabold text-emerald-700 shadow-sm sm:text-sm md:flex"
			>
				<span class="relative flex h-3 w-3">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
				</span>
				<span class="tracking-wide">พร้อมทำงาน</span>
			</div>
		</div>
	</header>

	<!-- Main Stage: Takes full height and scales flexibly across vertical/horizontal screens -->
	<main
		class="relative z-10 flex w-full flex-1 flex-col items-center justify-center overflow-y-auto p-4 sm:p-6 lg:px-8 lg:py-4 xl:px-12 xl:py-6"
	>
		{@render children()}
	</main>

	<!-- Bottom Footer (Light Theme, Clear Compliance) -->
	<footer
		class="relative z-10 flex shrink-0 flex-col items-center justify-between gap-2 border-t border-slate-200/90 bg-white/95 px-6 py-3.5 text-center text-xs font-medium text-slate-600 shadow-sm backdrop-blur-md sm:flex-row sm:px-8 sm:text-sm"
	>
		<div class="flex items-center gap-2 text-slate-700">
			<ShieldCheck class="h-4 w-4 shrink-0 text-blue-600 sm:h-5 sm:w-5" />
			<span class="font-semibold">
				ระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA Compliant) — ข้อมูลถูกเข้ารหัสความปลอดภัยระดับสูง
			</span>
		</div>
		<p class="text-xs font-semibold text-slate-400">Smart Card Kiosk Station</p>
	</footer>
</div>

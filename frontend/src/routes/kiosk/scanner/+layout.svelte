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
	class="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-slate-950 font-sans text-slate-100 selection:bg-cyan-500 selection:text-white"
>
	<!-- Ambient atmospheric glow backgrounds with fluid positioning -->
	<div
		class="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-[120px]"
	></div>
	<div
		class="pointer-events-none absolute top-1/4 -left-32 h-80 w-80 rounded-full bg-blue-600/10 blur-[120px]"
	></div>
	<div
		class="pointer-events-none absolute -right-32 bottom-12 h-96 w-96 rounded-full bg-indigo-600/15 blur-[140px]"
	></div>

	<!-- Top Header (Responsive for Portrait, Landscape, Mobile, Desktop) -->
	<header
		class="relative z-10 flex shrink-0 flex-col gap-3 border-b border-slate-800/80 bg-slate-900/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4 md:flex-row md:items-center md:justify-between"
	>
		<!-- Brand & Station Identity -->
		<div class="flex items-center justify-between md:justify-start md:gap-4">
			<div class="flex items-center gap-3">
				<div
					class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-md ring-1 shadow-cyan-500/25 ring-white/20"
				>
					<Tent class="h-6 w-6 text-white" />
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="text-base font-black tracking-tight text-white sm:text-lg">SmartShelter</h1>
						<span
							class="rounded-md bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
							>KIOSK</span
						>
					</div>
					<p class="text-xs font-medium text-slate-400">จุดบริการสแกนบัตรประชาชน</p>
				</div>
			</div>

			<!-- Mobile Ready Badge -->
			<div
				class="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 shadow-sm shadow-emerald-500/10 md:hidden"
			>
				<span class="relative flex h-2 w-2">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
				</span>
				<span class="text-[11px] font-bold">พร้อมทำงาน</span>
			</div>
		</div>

		<!-- Clock & Desktop Status Badge -->
		<div class="flex items-center justify-between gap-4 md:justify-end">
			<div
				class="flex flex-1 items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-1.5 font-mono text-xs shadow-inner sm:px-4 sm:py-2 md:flex-initial"
			>
				<div class="flex items-center gap-1.5 text-slate-400">
					<Cpu class="h-3.5 w-3.5 text-cyan-400" />
					<span class="hidden text-[11px] sm:inline">Smart Card Station</span>
				</div>
				<div class="flex items-center gap-2.5">
					<span class="font-sans text-[11px] text-slate-400">{dateString}</span>
					<span class="font-bold tracking-wider text-cyan-400 sm:text-sm">{timeString}</span>
				</div>
			</div>

			<!-- Desktop Ready Badge -->
			<div
				class="hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-400 shadow-sm shadow-emerald-500/10 md:flex"
			>
				<span class="relative flex h-2 w-2">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
				</span>
				<span class="text-xs font-bold tracking-wide">พร้อมทำงาน</span>
			</div>
		</div>
	</header>

	<!-- Main Responsive Stage -->
	<main
		class="relative z-10 flex w-full flex-1 items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10"
	>
		{@render children()}
	</main>

	<!-- Bottom Footer (Fluid Responsive) -->
	<footer
		class="relative z-10 flex shrink-0 flex-col items-center justify-between gap-2 border-t border-slate-800/80 bg-slate-900/60 px-4 py-3 text-center text-xs text-slate-400 backdrop-blur-md sm:flex-row sm:px-6"
	>
		<div class="flex items-center gap-2 text-slate-300">
			<ShieldCheck class="h-4 w-4 shrink-0 text-cyan-400" />
			<span class="text-[11px] font-medium sm:text-xs">
				ระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA Compliant) — เข้ารหัสความปลอดภัย
			</span>
		</div>
		<p class="text-[10px] text-slate-500 sm:text-[11px]">
			SmartShelter OS • Smart Card Kiosk Edition
		</p>
	</footer>
</div>

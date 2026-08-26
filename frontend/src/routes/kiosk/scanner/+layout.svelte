<script lang="ts">
	import type { Snippet } from 'svelte';
	import Tent from '@lucide/svelte/icons/tent';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

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
	class="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100 selection:bg-primary selection:text-white"
>
	<!-- Ambient glow background -->
	<div
		class="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]"
	></div>
	<div
		class="pointer-events-none absolute -right-40 -bottom-40 h-96 w-96 rounded-full bg-blue-600/10 blur-[120px]"
	></div>

	<!-- Header Bar -->
	<header
		class="flex h-20 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-8 backdrop-blur-md"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 shadow-lg shadow-cyan-500/20"
			>
				<Tent class="h-7 w-7 text-white" />
			</div>
			<div>
				<h1 class="text-xl font-extrabold tracking-tight text-white">SmartShelter</h1>
				<p class="text-xs font-medium text-slate-400">จุดบริการสแกนบัตรประชาชน (Kiosk Station)</p>
			</div>
		</div>

		<div class="flex items-center gap-6">
			<div class="text-right">
				<div class="font-mono text-2xl font-bold tracking-wider text-cyan-400">{timeString}</div>
				<div class="text-xs text-slate-400">{dateString}</div>
			</div>
			<div
				class="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-400"
			>
				<span class="h-2 w-2 animate-ping rounded-full bg-emerald-400"></span>
				<span>ระบบพร้อมทำงาน</span>
			</div>
		</div>
	</header>

	<!-- Main Stage -->
	<main class="flex flex-1 items-center justify-center p-8">
		{@render children()}
	</main>

	<!-- Footer Bar -->
	<footer
		class="flex h-14 shrink-0 items-center justify-between border-t border-slate-800/60 bg-slate-900/40 px-8 text-xs text-slate-400"
	>
		<div class="flex items-center gap-2">
			<ShieldCheck class="h-4 w-4 text-cyan-400" />
			<span>ระบบคุ้มครองข้อมูลส่วนบุคคล (PDPA Compliant) — ข้อมูลได้รับการเข้ารหัสความปลอดภัย</span>
		</div>
		<div class="font-mono text-slate-400">SmartShelter OS • Kiosk Mode</div>
	</footer>
</div>

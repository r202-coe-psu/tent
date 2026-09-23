<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Tent from '@lucide/svelte/icons/tent';

	interface Props {
		shelterName: string;
		shelterCode: string;
		stationName: string;
		deviceName: string;
		showClock?: boolean;
		children?: Snippet;
	}

	let {
		shelterName,
		shelterCode,
		stationName,
		deviceName,
		showClock = true,
		children
	}: Props = $props();

	let now = $state(new Date());
	$effect(() => {
		if (!showClock) return;
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const timeString = $derived(
		now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
	);
	const dateString = $derived(
		now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
	);
</script>

<div
	class="flex min-h-svh w-full flex-col bg-[#F8FAFC] pb-[var(--testing-banner-height)] font-sans text-slate-900 selection:bg-[#0A2647] selection:text-white"
>
	<header
		class="flex min-h-14 shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 sm:px-5"
	>
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-2.5">
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647] text-white"
					aria-hidden="true"
				>
					<Tent class="h-5 w-5" />
				</div>
				<div class="min-w-0">
					<p class="truncate text-sm leading-tight font-extrabold text-[#0A2647]">SmartShelter</p>
					<p
						class="truncate text-sm leading-tight font-medium text-slate-600"
						aria-label={`ศูนย์พักพิง ${shelterName} ${shelterCode} จุดบริการ ${stationName} เครื่อง ${deviceName}`}
					>
						{shelterName}{#if shelterCode}<span aria-hidden="true"> · {shelterCode}</span>{/if}
					</p>
				</div>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				{#if showClock}
					<div
						class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-700"
						aria-label={`เวลาปัจจุบัน ${dateString} ${timeString}`}
					>
						<Clock3 class="h-4 w-4 text-[#0A2647]" aria-hidden="true" />
						<span class="font-bold tabular-nums">{timeString}</span>
					</div>
				{/if}
				<div
					class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-sm font-bold text-emerald-900"
				>
					<CheckCircle2 class="h-4 w-4 text-emerald-700" aria-hidden="true" />
					<span>พร้อม</span>
				</div>
			</div>
		</div>
	</header>

	<main class="kiosk-main flex w-full flex-1 flex-col items-center px-3 sm:px-5">
		<div class="w-full max-w-5xl">
			{@render children?.()}
		</div>
	</main>

	<footer class="shrink-0 border-t border-slate-200 bg-white px-3 py-2 sm:px-5">
		<p
			class="mx-auto flex w-full max-w-5xl items-center justify-center gap-2 text-sm text-slate-600"
		>
			<ShieldCheck class="h-4 w-4 shrink-0 text-[#0A2647]" aria-hidden="true" />
			<span>ขอความช่วยเหลือ · เรียกเจ้าหน้าที่</span>
		</p>
	</footer>
</div>

<style>
	.kiosk-main {
		padding-block: 0.75rem;
	}

	@media (max-height: 650px) {
		.kiosk-main {
			padding-block: 0.25rem;
		}
	}
</style>

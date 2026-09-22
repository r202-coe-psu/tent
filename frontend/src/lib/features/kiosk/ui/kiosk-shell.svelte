<script lang="ts">
	import type { Snippet } from 'svelte';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import Cpu from '@lucide/svelte/icons/cpu';
	import MapPin from '@lucide/svelte/icons/map-pin';
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
	class="flex min-h-svh w-full flex-col bg-[#F8FAFC] pb-[var(--testing-banner-height)] font-sans text-slate-900 selection:bg-[#0A2647] selection:text-white"
>
	<header
		class="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4 lg:px-8"
	>
		<div
			class="mx-auto flex w-full max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
		>
			<div class="flex min-w-0 items-start gap-3 sm:gap-4">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0A2647] text-white shadow-xs sm:h-14 sm:w-14"
					aria-hidden="true"
				>
					<Tent class="h-7 w-7 sm:h-8 sm:w-8" />
				</div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<p class="text-xl font-extrabold tracking-tight text-[#0A2647] sm:text-2xl">
							SmartShelter
						</p>
						<span class="text-sm font-semibold text-slate-600">จุดบริการยืนยันตัวตน</span>
					</div>
					<div
						class="mt-2 flex max-w-full flex-wrap items-center gap-2 text-sm font-semibold"
						aria-label="ข้อมูลศูนย์พักพิงและจุดบริการ"
					>
						<div
							class="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900"
						>
							<Building2 class="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
							<span class="break-words">{shelterName}</span>
							{#if shelterCode}
								<span class="shrink-0 text-sky-700">({shelterCode})</span>
							{/if}
						</div>
						<div
							class="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
						>
							<MapPin class="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
							<span class="break-words">{stationName}</span>
						</div>
						<div
							class="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
						>
							<Cpu class="h-4 w-4 shrink-0 text-[#0A2647]" aria-hidden="true" />
							<span class="break-words">{deviceName}</span>
						</div>
					</div>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-3 lg:justify-end">
				{#if showClock}
					<div
						class="inline-flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
						aria-label={`เวลาปัจจุบัน ${dateString} ${timeString}`}
					>
						<Clock3 class="h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
						<span>
							<span class="block text-xs font-semibold text-slate-500">{dateString}</span>
							<span class="block text-base font-bold text-[#0A2647] tabular-nums">{timeString}</span
							>
						</span>
					</div>
				{/if}
				<div
					class="inline-flex min-h-12 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900"
				>
					<CheckCircle2 class="h-5 w-5 text-emerald-700" aria-hidden="true" />
					<span>พร้อมให้บริการ</span>
				</div>
			</div>
		</div>
	</header>

	<main class="flex w-full flex-1 flex-col items-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
		<div class="w-full max-w-7xl">
			{@render children?.()}
		</div>
	</main>

	<footer class="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
		<div
			class="mx-auto flex w-full max-w-7xl flex-col gap-2 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex items-center gap-2">
				<ShieldCheck class="h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
				<span>ระบบคุ้มครองข้อมูลส่วนบุคคล — ข้อมูลจะถูกอ่านเมื่อคุณเริ่มขั้นตอนเท่านั้น</span>
			</div>
			<p class="text-slate-500">หากใช้งานไม่สะดวก กรุณาเรียกเจ้าหน้าที่ประจำจุด</p>
		</div>
	</footer>
</div>

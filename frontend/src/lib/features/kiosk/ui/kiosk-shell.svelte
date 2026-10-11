<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import Tent from '@lucide/svelte/icons/tent';
	import { installReaderKeyGuard } from '../application/reader-key-guard';
	import { loadKioskHardware } from '../application/kiosk-qr-input';
	import { KIOSK_QR_PATH } from '../domain/identity-method';
	import { qrInputPlan } from '../domain/kiosk-hardware';
	import { KIOSK_COMPACT_MEDIA } from '../domain/kiosk-layout';
	import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';

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
	let compactHeader = $state(false);

	$effect(() => {
		const media = window.matchMedia(KIOSK_COMPACT_MEDIA);
		const updateCompactHeader = () => {
			compactHeader = media.matches;
		};
		updateCompactHeader();
		media.addEventListener('change', updateCompactHeader);
		return () => media.removeEventListener('change', updateCompactHeader);
	});
	// A USB QR reader types into whatever has focus (the phone numpad would take the code's
	// digits and its Enter would press "search"), so on machines that have one, the keys of a
	// reader burst are swallowed everywhere except /kiosk/qr, which reads the reader itself.
	onMount(() => {
		let destroyed = false;
		let removeGuard: (() => void) | undefined;
		void loadKioskHardware().then((hardware) => {
			const plan = qrInputPlan(hardware);
			if (destroyed || !plan.readerEnabled) return;
			removeGuard = installReaderKeyGuard(window, plan.readerMaxGapMs, () =>
				page.url.pathname.startsWith(KIOSK_QR_PATH)
			);
		});
		return () => {
			destroyed = true;
			removeGuard?.();
		};
	});
	$effect(() => {
		if (!showClock) return;
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});

	const timeString = $derived(
		now.toLocaleTimeString(DISPLAY_LOCALE, {
			timeZone: DISPLAY_TIME_ZONE,
			hour: '2-digit',
			minute: '2-digit'
		})
	);
	const dateString = $derived(
		now.toLocaleDateString(DISPLAY_LOCALE, {
			timeZone: DISPLAY_TIME_ZONE,
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		})
	);
</script>

<div
	data-kiosk-shell
	class="flex min-h-svh w-full flex-col bg-[#F8FAFC] pb-[var(--testing-banner-height)] font-sans text-slate-900 selection:bg-[#0A2647] selection:text-white"
>
	{#if !compactHeader}
		<header
			class="flex min-h-14 shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2 sm:px-5 kiosk-portrait:min-h-20 kiosk-portrait:px-6 kiosk-portrait:py-3"
		>
			<div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2.5">
					<div
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647] text-white kiosk-portrait:h-12 kiosk-portrait:w-12"
						aria-hidden="true"
					>
						<Tent class="h-5 w-5 kiosk-portrait:h-7 kiosk-portrait:w-7" />
					</div>
					<div class="min-w-0">
						<p
							class="truncate text-sm leading-tight font-extrabold text-[#0A2647] kiosk-portrait:text-lg"
						>
							SmartShelter
						</p>
						<p
							class="truncate text-sm leading-tight font-medium text-slate-600 kiosk-portrait:text-lg"
							aria-label={`ศูนย์พักพิง ${shelterName} ${shelterCode} จุดบริการ ${stationName} เครื่อง ${deviceName}`}
						>
							{shelterName}{#if shelterCode}<span aria-hidden="true"> · {shelterCode}</span>{/if}
						</p>
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-2">
					{#if showClock}
						<div
							class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-700 kiosk-portrait:min-h-12 kiosk-portrait:px-3 kiosk-portrait:text-base"
							aria-label={`เวลาปัจจุบัน ${dateString} ${timeString}`}
						>
							<Clock3
								class="h-4 w-4 text-[#0A2647] kiosk-portrait:h-5 kiosk-portrait:w-5"
								aria-hidden="true"
							/>
							<span class="font-bold tabular-nums">{timeString}</span>
						</div>
					{/if}
					<div
						class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-sm font-bold text-emerald-900 kiosk-portrait:min-h-12 kiosk-portrait:px-4 kiosk-portrait:text-base"
					>
						<CheckCircle2
							class="h-4 w-4 text-emerald-700 kiosk-portrait:h-5 kiosk-portrait:w-5"
							aria-hidden="true"
						/>
						<span>พร้อม</span>
					</div>
				</div>
			</div>
		</header>
	{/if}

	{#if compactHeader}
		<div
			class="flex min-h-7 shrink-0 items-center justify-center border-b border-slate-200 bg-white px-3 text-xs font-medium text-slate-600"
		>
			<span class="truncate"
				>ศูนย์พักพิง {shelterName}{#if shelterCode}
					· {shelterCode}{/if}</span
			>
		</div>
	{/if}

	<main
		class="kiosk-main flex w-full flex-1 flex-col items-center px-3 sm:px-5 kiosk-portrait:px-6"
	>
		<div class="flex min-h-0 w-full max-w-5xl flex-1 flex-col">
			{@render children?.()}
		</div>
	</main>
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

	/* 24" portrait: raise the app's 18px root (app.css) to 20px at 1080 wide while a kiosk screen
	   is mounted; the floor keeps narrower portrait screens at the base size. Media-query rem
	   units ignore this (they use the 16px initial size). */
	@media screen and (orientation: portrait) and (min-height: 1200px) {
		:global(html:has([data-kiosk-shell])) {
			font-size: clamp(18px, calc(100vw / 54), 22px);
		}

		.kiosk-main {
			padding-block: 1.5rem;
		}
	}
</style>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import { resolve } from '$app/paths';
	import { languageStore } from '$lib/stores/language.svelte';
	import { installReaderKeyGuard } from '../application/reader-key-guard';
	import { loadKioskHardware } from '../application/kiosk-qr-input';
	import { isKioskHomePath, KIOSK_LANGUAGE_PATH, KIOSK_QR_PATH } from '../domain/identity-method';
	import { qrInputPlan } from '../domain/kiosk-hardware';
	import { buildKioskContextQuery, readKioskDisplayQuery } from '../domain/display-context';
	import { KIOSK_COMPACT_MEDIA } from '../domain/kiosk-layout';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_COMMON_I18N } from './_constants/kiosk-common.i18n';
	import { KIOSK_LANGUAGE_I18N } from './_constants/kiosk-language.i18n';
	import KioskFlag from './kiosk-flag.svelte';
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

	const t = $derived(getTranslation(KIOSK_COMMON_I18N, languageStore.current).shell);

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

	// Home only: the picker always lands on the method page, so mid-visit it would drop the visit.
	const showLanguageButton = $derived(isKioskHomePath(page.url.pathname));
	const languageQuery = $derived(
		buildKioskContextQuery(readKioskDisplayQuery(page.url.searchParams))
	);

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

{#snippet languageButton(buttonClass: string, flagClass: string)}
	{#if showLanguageButton}
		<a
			href={resolve(`${KIOSK_LANGUAGE_PATH}${languageQuery}`)}
			aria-label={KIOSK_LANGUAGE_I18N.shellButton.ariaLabel}
			data-testid="kiosk-language-button"
			class={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white font-semibold whitespace-nowrap text-[#0A2647] no-underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none active:bg-slate-100 ${buttonClass}`}
		>
			<KioskFlag
				code={languageStore.current}
				decorative
				class={`shrink-0 rounded-xs ${flagClass}`}
			/>
			<span>{KIOSK_LANGUAGE_I18N.shellButton.label}</span>
		</a>
	{/if}
{/snippet}

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
					<img
						src="/logo.png"
						alt=""
						class="h-9 w-9 shrink-0 rounded-lg object-contain kiosk-portrait:h-12 kiosk-portrait:w-12"
					/>
					<div class="min-w-0">
						<p
							class="truncate text-sm leading-tight font-extrabold text-[#0A2647] kiosk-portrait:text-lg"
						>
							SmartShelter
						</p>
						<p
							class="truncate text-sm leading-tight font-medium text-slate-600 kiosk-portrait:text-lg"
							aria-label={t.shelterAria(shelterName, shelterCode, stationName, deviceName)}
						>
							{shelterName}{#if shelterCode}<span aria-hidden="true"> · {shelterCode}</span>{/if}
						</p>
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-2">
					{@render languageButton(
						'min-h-10 px-2.5 text-sm kiosk-portrait:min-h-12 kiosk-portrait:px-3 kiosk-portrait:text-base',
						'h-[19px] w-[28px] kiosk-portrait:h-[24px] kiosk-portrait:w-[36px]'
					)}
					{#if showClock}
						<div
							class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-700 kiosk-portrait:min-h-12 kiosk-portrait:px-3 kiosk-portrait:text-base"
							aria-label={t.clockAria(dateString, timeString)}
						>
							<Clock3
								class="h-4 w-4 text-[#0A2647] kiosk-portrait:h-5 kiosk-portrait:w-5"
								aria-hidden="true"
							/>
							<span class="font-bold tabular-nums">{timeString}</span>
						</div>
					{/if}
				</div>
			</div>
		</header>
	{/if}

	{#if compactHeader}
		<div
			class="relative flex min-h-12 shrink-0 items-center justify-center border-b border-slate-200 bg-white px-3 text-sm font-medium text-slate-600"
		>
			<span class="truncate"
				>{t.shelterPrefix(shelterName)}{#if shelterCode}
					· {shelterCode}{/if}</span
			>
			{#if showLanguageButton}
				<!-- Overlaid at the strip's right edge so the shelter name stays centred. -->
				<div class="absolute top-1/2 right-2 z-10 -translate-y-1/2">
					{@render languageButton('h-10 px-2.5 text-sm', 'h-[16px] w-[24px]')}
				</div>
			{/if}
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

	/* app.css reserves a stable scrollbar gutter on <html>; on the kiosk's classic-scrollbar
	   Chromium that leaves a blank ~15px strip down the right edge of every kiosk screen. */
	:global(html:has([data-kiosk-shell])) {
		scrollbar-gutter: auto;
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

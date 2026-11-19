<script lang="ts">
	import { flushSync, onMount } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { kioskLabelDots, kioskQrPrintSize } from '../domain/print-label';
	import { KioskIdleTimeout } from './kiosk-idle-timeout.svelte.js';
	import { KIOSK_LABEL_SCREEN_I18N } from './_constants/kiosk-label-screen.i18n';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	interface Props {
		/** PNG labels as renderKioskLabelPng returns them: raw base64, no data: prefix. */
		labels: readonly string[];
		ondone: () => void;
		/** Shown above the image, e.g. when some members' QR could not be issued. */
		notice?: string;
	}

	let { labels, ondone, notice }: Props = $props();
	const t = $derived(getTranslation(KIOSK_LABEL_SCREEN_I18N, languageStore.current));

	/** Smallest side, in CSS px, a phone camera needs to read the QR off the screen. */
	const QR_MIN_CSS_PX = 240;
	/** QR versions 1–6 cover every kiosk payload; a marker band gives the code its least room. */
	const SMALLEST_QR_CODE_DOTS = Math.min(
		...[21, 25, 29, 33, 37, 41].map(
			(modules) => modules * kioskQrPrintSize(modules, 'red').dotsPerModule
		)
	);
	const LABEL_IMAGE_WIDTH_PX = Math.ceil(
		(QR_MIN_CSS_PX * kioskLabelDots().width) / SMALLEST_QR_CODE_DOTS
	);

	let requestedIndex = $state(0);
	const total = $derived(labels.length);
	const index = $derived(Math.min(requestedIndex, Math.max(total - 1, 0)));

	/** Long enough to photograph a QR and bring the phone to staff before the screen clears. */
	const LABEL_SCREEN_IDLE_MS = 120_000;
	const idleTimeout = new KioskIdleTimeout(LABEL_SCREEN_IDLE_MS, () => ondone());

	let previousButton: HTMLButtonElement | null = $state(null);
	let nextButton: HTMLButtonElement | null = $state(null);

	onMount(() => {
		idleTimeout.start();
		return () => idleTimeout.stop();
	});

	function step(delta: number): void {
		idleTimeout.recordActivity();
		requestedIndex = index + delta;
		flushSync();
		if (requestedIndex === 0) nextButton?.focus();
		else if (requestedIndex === total - 1) previousButton?.focus();
	}
</script>

<svelte:window onpointerdown={() => idleTimeout.recordActivity()} />

<section
	{@attach (element) => element.focus()}
	tabindex="-1"
	aria-label={t.hint}
	class="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none kiosk-portrait:max-w-5xl kiosk-portrait:gap-6 kiosk-portrait:p-10 kiosk-compact:grid kiosk-compact:max-w-none kiosk-compact:grid-cols-[auto_18rem] kiosk-compact:grid-rows-[1fr_auto] kiosk-compact:items-center kiosk-compact:justify-center kiosk-compact:gap-x-4 kiosk-compact:gap-y-3 kiosk-compact:p-4"
	data-testid="kiosk-label-screen"
>
	<div
		class="flex w-full flex-col items-center gap-4 kiosk-portrait:gap-6 kiosk-compact:col-start-2 kiosk-compact:row-start-1 kiosk-compact:gap-3"
	>
		<p
			class="text-center text-xl font-bold text-[#0A2647] kiosk-portrait:text-3xl kiosk-compact:text-lg"
		>
			{t.hint}
		</p>
		{#if notice}
			<p
				role="status"
				class="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-lg font-semibold text-amber-900 kiosk-portrait:text-2xl kiosk-compact:py-2 kiosk-compact:text-base"
			>
				{notice}
			</p>
		{/if}
	</div>
	{#if total > 0}
		<img
			class="h-auto w-(--label-w) max-w-full rounded-xl border border-slate-200 bg-white [image-rendering:pixelated] kiosk-portrait:w-full kiosk-compact:col-start-1 kiosk-compact:row-span-2 kiosk-compact:row-start-1 kiosk-compact:max-h-[calc(100svh-13rem)] kiosk-compact:w-auto"
			style:--label-w={`${LABEL_IMAGE_WIDTH_PX}px`}
			src={`data:image/png;base64,${labels[index]}`}
			alt={t.imageAlt(index + 1, total)}
		/>
	{/if}
	<div
		class="flex w-full flex-col items-center gap-4 kiosk-portrait:gap-6 kiosk-compact:col-start-2 kiosk-compact:row-start-2 kiosk-compact:gap-3"
	>
		{#if total > 1}
			<p
				class="text-lg font-semibold text-slate-700 tabular-nums kiosk-portrait:text-2xl"
				aria-live="polite"
				aria-atomic="true"
			>
				{t.counter(index + 1, total)}
			</p>
			<div class="flex w-full gap-3 kiosk-portrait:gap-4">
				<Button
					bind:ref={previousButton}
					variant="outline"
					class={`${KIOSK_NOTICE_SECONDARY_ACTION} flex-1`}
					disabled={index === 0}
					onclick={() => step(-1)}
				>
					<ChevronLeft aria-hidden="true" />
					{t.previous}
				</Button>
				<Button
					bind:ref={nextButton}
					variant="outline"
					class={`${KIOSK_NOTICE_SECONDARY_ACTION} flex-1`}
					disabled={index === total - 1}
					onclick={() => step(1)}
				>
					{t.next}
					<ChevronRight aria-hidden="true" />
				</Button>
			</div>
		{/if}
		<Button class={KIOSK_NOTICE_PRIMARY_ACTION} onclick={ondone}>
			{t.done}
		</Button>
	</div>
</section>

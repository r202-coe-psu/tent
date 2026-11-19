<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KioskIdleTimeout } from './kiosk-idle-timeout.svelte.js';
	import { KIOSK_LABEL_SCREEN_I18N } from './_constants/kiosk-label-screen.i18n';

	interface Props {
		/** PNG labels as renderKioskLabelPng returns them: raw base64, no data: prefix. */
		labels: readonly string[];
		ondone: () => void;
	}

	let { labels, ondone }: Props = $props();
	const t = $derived(getTranslation(KIOSK_LABEL_SCREEN_I18N, languageStore.current));

	const ACTION_SIZE =
		'min-h-16 gap-3 px-6 text-xl font-bold kiosk-portrait:min-h-24 kiosk-portrait:text-3xl kiosk-compact:min-h-12 kiosk-compact:text-base [&_svg]:size-6! kiosk-portrait:[&_svg]:size-8!';

	let index = $state(0);
	const total = $derived(labels.length);

	/** Long enough to photograph a QR and bring the phone to staff before the screen clears. */
	const LABEL_SCREEN_IDLE_MS = 120_000;
	const idleTimeout = new KioskIdleTimeout(LABEL_SCREEN_IDLE_MS, () => ondone());

	onMount(() => {
		idleTimeout.start();
		return () => idleTimeout.stop();
	});

	function step(delta: number): void {
		idleTimeout.recordActivity();
		index += delta;
	}
</script>

<section
	class="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs kiosk-portrait:gap-6 kiosk-portrait:p-10 kiosk-compact:gap-3 kiosk-compact:p-4"
	data-testid="kiosk-label-screen"
>
	<p
		class="text-center text-xl font-bold text-[#0A2647] kiosk-portrait:text-3xl kiosk-compact:text-lg"
	>
		{t.hint}
	</p>
	<img
		class="h-auto w-[min(90vw,40rem)] max-w-full rounded-xl border border-slate-200 bg-white"
		src={`data:image/png;base64,${labels[index]}`}
		alt={t.imageAlt(index + 1, total)}
	/>
	{#if total > 1}
		<p
			class="text-lg font-semibold text-slate-700 tabular-nums kiosk-portrait:text-2xl"
			aria-live="polite"
		>
			{t.counter(index + 1, total)}
		</p>
		<div class="flex w-full gap-3 kiosk-portrait:gap-4">
			<Button
				variant="outline"
				class={`${ACTION_SIZE} flex-1 border-[#CBD5E1] text-[#0A2647]`}
				disabled={index === 0}
				onclick={() => step(-1)}
			>
				<ChevronLeft aria-hidden="true" />
				{t.previous}
			</Button>
			<Button
				variant="outline"
				class={`${ACTION_SIZE} flex-1 border-[#CBD5E1] text-[#0A2647]`}
				disabled={index === total - 1}
				onclick={() => step(1)}
			>
				{t.next}
				<ChevronRight aria-hidden="true" />
			</Button>
		</div>
	{/if}
	<Button
		class={`${ACTION_SIZE} w-full bg-[#0A2647] text-white hover:bg-[#051930]`}
		onclick={ondone}
	>
		{t.done}
	</Button>
</section>

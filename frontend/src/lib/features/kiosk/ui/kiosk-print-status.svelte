<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Printer from '@lucide/svelte/icons/printer';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_PRINT_I18N } from './_constants/kiosk-print.i18n';

	interface Props {
		phase: 'printing' | 'done';
		count: number;
	}

	let { phase, count }: Props = $props();
	const t = $derived(getTranslation(KIOSK_PRINT_I18N, languageStore.current).status);
</script>

<div
	class="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#0A2647]/40 p-6 backdrop-blur-sm"
	transition:fade={{ duration: 150 }}
>
	<div
		class="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-8 text-center shadow-xl"
		role="status"
		aria-live="polite"
	>
		{#if phase === 'printing'}
			<div class="relative h-32 w-28" aria-hidden="true">
				<div
					class="label-paper absolute top-14 left-1/2 flex h-16 w-16 -translate-x-1/2 items-end justify-center rounded-sm border-2 border-slate-300 bg-white pb-1"
				>
					<QrCode class="h-7 w-7 text-slate-800" />
				</div>
				<Printer class="relative h-24 w-28 fill-white text-[#0A2647]" strokeWidth={1.5} />
			</div>
			<div>
				<p class="text-xl font-extrabold text-[#0A2647]">{t.printingTitle}</p>
				<p class="mt-1 text-base text-slate-700">{t.printingBody(count)}</p>
			</div>
		{:else}
			<div in:scale={{ duration: 200, start: 0.6 }} aria-hidden="true">
				<CheckCircle2 class="h-24 w-24 text-emerald-600" strokeWidth={1.75} />
			</div>
			<div>
				<p class="text-xl font-extrabold text-[#0A2647]">{t.doneTitle}</p>
				<p class="mt-1 text-base text-slate-700">{t.doneBody(count)}</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.label-paper {
		animation: feed 1.2s ease-out infinite;
	}

	@keyframes feed {
		from {
			transform: translateY(-2.5rem);
			opacity: 0;
		}
		30% {
			opacity: 1;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.label-paper {
			animation: none;
		}
	}
</style>

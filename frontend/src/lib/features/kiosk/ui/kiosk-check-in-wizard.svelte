<script lang="ts">
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_COMMON_I18N } from './_constants/kiosk-common.i18n';

	interface Props {
		currentStep: 1 | 2 | 3 | 4 | 5;
		step2Label?: string;
		/** Identity-check flows (card face check, ThaiD) verify here instead of a plain lookup. */
		step3Label?: string;
		/** Walk-in registration asks for a phone here instead of picking members. */
		step4Label?: string;
	}

	let { currentStep, step2Label, step3Label, step4Label }: Props = $props();

	const t = $derived(getTranslation(KIOSK_COMMON_I18N, languageStore.current).wizard);

	const steps = $derived([
		{ id: 1, label: t.method },
		{ id: 2, label: step2Label ?? t.scan },
		{ id: 3, label: step3Label ?? t.lookup },
		{ id: 4, label: step4Label ?? t.members },
		{ id: 5, label: t.done }
	]);
	const currentLabel = $derived(steps[currentStep - 1].label);
</script>

<nav class="kiosk-check-in-wizard px-1" aria-label={t.navLabel}>
	<div class="mb-2 flex items-center justify-between gap-3 text-sm kiosk-portrait:text-lg">
		<p class="truncate font-semibold text-[#0A2647]" aria-live="polite">
			{t.progress(currentStep, currentLabel)}
		</p>
	</div>
	<div class="mt-2">
		<ol class="progress-dashes flex w-full items-center" aria-label={t.listLabel}>
			{#each steps as step (step.id)}
				<li
					class="min-w-0 flex-1"
					aria-label={`${step.id}. ${step.label}`}
					aria-current={step.id === currentStep ? 'step' : undefined}
				>
					<span
						class={`progress-dash block w-full rounded-full ${
							step.id < currentStep
								? 'bg-[#16A34A]'
								: step.id === currentStep
									? 'bg-[#0A2647]'
									: 'bg-slate-200'
						}`}
						aria-hidden="true"
					></span>
					<span class="sr-only">{step.label}</span>
				</li>
			{/each}
		</ol>
	</div>
</nav>

<style>
	.kiosk-check-in-wizard {
		position: relative;
		left: 50%;
		width: min(calc(100vw - 2rem), 120rem);
		max-width: none;
		transform: translateX(-50%);
	}

	.progress-dashes {
		gap: clamp(0.5rem, 1vw, 1.25rem);
	}

	.progress-dash {
		height: clamp(0.5rem, 0.7vw, 0.85rem);
	}

	/* The vw-based height above only reaches ~7.5px at 1080 wide. */
	@media screen and (orientation: portrait) and (min-height: 1200px) {
		.progress-dash {
			height: 0.6rem;
		}
	}
</style>

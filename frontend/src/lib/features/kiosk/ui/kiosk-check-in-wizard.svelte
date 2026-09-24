<script lang="ts">
	interface Props {
		currentStep: 1 | 2 | 3 | 4 | 5;
		step2Label?: string;
	}

	let { currentStep, step2Label = 'สแกน' }: Props = $props();

	const steps = $derived([
		{ id: 1, label: 'วิธีค้นหา' },
		{ id: 2, label: step2Label },
		{ id: 3, label: 'ค้นหา' },
		{ id: 4, label: 'สมาชิก' },
		{ id: 5, label: 'เสร็จสิ้น' }
	]);
	const currentLabel = $derived(steps[currentStep - 1].label);
</script>

<nav class="kiosk-check-in-wizard px-1" aria-label="ขั้นตอนรายงานตัว">
	<div class="mb-2 flex items-center justify-between gap-3 text-sm">
		<p class="truncate font-semibold text-[#0A2647]" aria-live="polite">
			ขั้น {currentStep} จาก 5 · {currentLabel}
		</p>
	</div>
	<div class="mt-2">
		<ol class="progress-dashes flex w-full items-center" aria-label="5 ขั้นตอน">
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
</style>

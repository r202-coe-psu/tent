<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Circle from '@lucide/svelte/icons/circle';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Image from '@lucide/svelte/icons/image';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Save from '@lucide/svelte/icons/save';
	import {
		CARD_READ_STAGES,
		cardReadStatusText,
		type CardReadStage
	} from '../domain/card-read-progress';

	interface Props {
		/** 0–100 */
		percent: number;
		stage: CardReadStage;
	}

	let { percent, stage }: Props = $props();

	const RADIUS = 54;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	const value = $derived(Math.min(100, Math.max(0, Math.round(percent))));
	const dashOffset = $derived(CIRCUMFERENCE * (1 - value / 100));
	const currentIndex = $derived(CARD_READ_STAGES.indexOf(stage));

	const STEP_LABELS: Record<CardReadStage, string> = {
		data: 'อ่านข้อมูลบัตร',
		photo: 'อ่านรูปถ่าย',
		saving: 'บันทึกข้อมูล'
	};
	const STEP_ICONS = { data: IdCard, photo: Image, saving: Save } as const;

	type StepState = 'done' | 'current' | 'pending';
	function stateOf(index: number): StepState {
		if (index < currentIndex) return 'done';
		return index === currentIndex ? 'current' : 'pending';
	}
	const STATE_TEXT: Record<StepState, string> = {
		done: 'เสร็จแล้ว',
		current: 'กำลังดำเนินการ',
		pending: 'รอดำเนินการ'
	};
	const STATE_CLASS: Record<StepState, string> = {
		done: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		current: 'border-sky-200 bg-sky-50 text-sky-900',
		pending: 'border-slate-200 bg-white text-slate-500'
	};
</script>

<!--
	Landscape panel (1024×600): ring on the left, steps on the right, so the warning and the cancel
	button below still fit on screen. Portrait monitor: stacked and scaled up for the viewing distance.
-->
<div
	class="flex flex-col items-center gap-5 sm:flex-row sm:justify-center sm:gap-10 kiosk-portrait:flex-col kiosk-portrait:gap-8"
	data-testid="kiosk-card-read-progress"
>
	<div
		class="relative size-32 shrink-0 kiosk-portrait:size-64"
		role="progressbar"
		aria-label="ความคืบหน้าการอ่านบัตรประชาชน"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={value}
		aria-valuetext="{value}% {cardReadStatusText(stage)}"
	>
		<svg viewBox="0 0 120 120" class="size-full -rotate-90" aria-hidden="true">
			<circle cx="60" cy="60" r={RADIUS} fill="none" stroke-width="10" class="stroke-slate-200" />
			<circle
				cx="60"
				cy="60"
				r={RADIUS}
				fill="none"
				stroke-width="10"
				stroke-linecap="round"
				class="stroke-[#0A2647] transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
				stroke-dasharray={CIRCUMFERENCE}
				stroke-dashoffset={dashOffset}
			/>
		</svg>
		<div class="absolute inset-0 flex items-center justify-center">
			<span
				class="text-4xl font-extrabold text-[#0A2647] tabular-nums kiosk-portrait:text-7xl"
				data-testid="kiosk-card-read-percent"
				>{value}<span class="text-xl kiosk-portrait:text-4xl">%</span></span
			>
		</div>
	</div>

	<!-- The steps below show the same thing; this announces each change to screen readers. -->
	<p class="sr-only" role="status" aria-live="polite" data-testid="kiosk-register-card-busy">
		{cardReadStatusText(stage)}
	</p>

	<ol class="grid w-full max-w-md gap-2 kiosk-portrait:max-w-2xl kiosk-portrait:gap-4">
		{#each CARD_READ_STAGES as step, index (step)}
			{@const stepState = stateOf(index)}
			{@const Icon = STEP_ICONS[step]}
			<li
				class="flex min-h-12 items-center gap-3 rounded-xl border px-4 py-2 text-left kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 {STATE_CLASS[
					stepState
				]}"
				aria-current={stepState === 'current' ? 'step' : undefined}
			>
				<span
					class="flex size-8 shrink-0 items-center justify-center kiosk-portrait:size-12"
					aria-hidden="true"
				>
					{#if stepState === 'done'}
						<Check class="size-6 kiosk-portrait:size-10" strokeWidth={3} />
					{:else if stepState === 'current'}
						<LoaderCircle
							class="size-6 animate-spin motion-reduce:animate-none kiosk-portrait:size-10"
						/>
					{:else}
						<Circle class="size-5 kiosk-portrait:size-9" />
					{/if}
				</span>
				<span
					class="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold kiosk-portrait:gap-3 kiosk-portrait:text-3xl"
				>
					<Icon class="size-5 shrink-0 kiosk-portrait:size-8" aria-hidden="true" />
					{STEP_LABELS[step]}
				</span>
				<span
					class="shrink-0 text-sm font-medium kiosk-portrait:text-2xl"
					data-testid="kiosk-card-read-step-state">{STATE_TEXT[stepState]}</span
				>
			</li>
		{/each}
	</ol>
</div>

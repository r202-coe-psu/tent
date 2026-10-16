<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Clock from '@lucide/svelte/icons/clock';
	import type { RequisitionTicketStatus } from '../../domain/food-supplies';
	import {
		SHIFT_CLOSE_STEPS,
		shiftCloseGuide,
		shiftCloseStepState
	} from '../model/shift-close-guide';

	interface Props {
		status: RequisitionTicketStatus;
	}

	let { status }: Props = $props();

	const guide = $derived(shiftCloseGuide(status));
</script>

<div class="space-y-3 rounded-xl border border-sky-200 bg-white p-4 shadow-2xs">
	<ol class="grid grid-cols-3 gap-2" aria-label="ขั้นตอนปิดรอบ">
		{#each SHIFT_CLOSE_STEPS as step, index (step.key)}
			{@const state = shiftCloseStepState(step.key, guide.current)}
			<li
				class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm {state === 'current'
					? 'border-sky-300 bg-sky-50 font-bold text-sky-900'
					: state === 'done'
						? 'border-emerald-200 bg-emerald-50 text-emerald-900'
						: 'border-slate-200 bg-white text-slate-500'}"
				aria-current={state === 'current' ? 'step' : undefined}
			>
				{#if state === 'done'}
					<CheckCircle2 class="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
				{:else}
					<span
						class="flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums {state ===
						'current'
							? 'bg-sky-600 text-white'
							: 'bg-slate-200 text-slate-600'}">{index + 1}</span
					>
				{/if}
				<span>{step.label}</span>
				<span class="sr-only">
					({state === 'done' ? 'เสร็จแล้ว' : state === 'current' ? 'ขั้นปัจจุบัน' : 'ยังไม่ถึง'})
				</span>
			</li>
		{/each}
	</ol>

	<p
		class="flex items-start gap-2 rounded-lg px-3 py-2.5 text-base {guide.deskActs
			? 'bg-sky-50 text-sky-950'
			: 'bg-slate-50 text-slate-700'}"
	>
		{#if guide.deskActs}
			<ArrowRight class="mt-1 size-4 shrink-0 text-sky-600" aria-hidden="true" />
			<span><strong>ตอนนี้ต้องทำ:</strong> {guide.nextAction}</span>
		{:else if guide.current === 'done'}
			<CheckCircle2 class="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
			<span>{guide.nextAction}</span>
		{:else}
			<Clock class="mt-1 size-4 shrink-0 text-slate-500" aria-hidden="true" />
			<span>{guide.nextAction}</span>
		{/if}
	</p>
</div>

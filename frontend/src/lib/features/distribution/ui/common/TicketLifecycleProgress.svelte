<script lang="ts">
	import type { RequisitionTicketStatus } from '../../domain/food-supplies';
	import { getLifecycleSteps } from '../model/ticket-lifecycle';
	import Check from '@lucide/svelte/icons/check';
	import Ban from '@lucide/svelte/icons/ban';
	import Clock from '@lucide/svelte/icons/clock';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Truck from '@lucide/svelte/icons/truck';
	import Send from '@lucide/svelte/icons/send';
	import Archive from '@lucide/svelte/icons/archive';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	interface Props {
		status: RequisitionTicketStatus;
		cancellationReason?: string;
		class?: string;
	}

	let { status, cancellationReason, class: className = '' }: Props = $props();

	const lifecycle = $derived(getLifecycleSteps(status));
	const isCancelled = $derived(lifecycle.isCancelled);
	const steps = $derived(lifecycle.steps);
</script>

<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 {className}">
	{#if isCancelled}
		<!-- Terminal Cancelled Branch Presentation -->
		<div class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3.5">
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white shadow-2xs"
			>
				<Ban class="h-5 w-5" aria-hidden="true" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<h4 class="text-sm font-bold text-red-900">ตั๋วถูกยกเลิก</h4>
					<span
						class="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-2xs font-semibold text-red-800"
					>
						สิ้นสุดก่อนปล่อยของ
					</span>
				</div>
				<p class="mt-0.5 text-xs text-red-700">
					{cancellationReason && cancellationReason.trim()
						? `เหตุผล: ${cancellationReason}`
						: 'ตั๋วใบนี้ถูกยกเลิกในขั้นตอนก่อนการส่งมอบสินค้า ไม่มีการเบิกจ่ายหรือตัดสต็อกจริง'}
				</p>
			</div>
		</div>
	{:else}
		<!-- Normal / Return Lifecycle Stepper -->
		<div class="relative">
			<nav aria-label="ขั้นตอนความคืบหน้าของตั๋วเบิกจ่าย">
				<ol class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					{#each steps as step, index (step.id)}
						{@const isCurrent = step.state === 'current'}
						{@const isCompleted = step.state === 'completed'}

						<li
							class="relative flex flex-1 items-center sm:flex-col sm:items-center sm:text-center"
							aria-current={isCurrent ? 'step' : undefined}
						>
							<!-- Connecting line between steps (horizontal on desktop) -->
							{#if index > 0}
								<div
									class="absolute top-4.5 -left-1/2 hidden h-0.5 w-full -translate-y-1/2 transition-colors sm:block {isCompleted ||
									isCurrent
										? 'bg-emerald-500'
										: 'bg-slate-200'}"
									aria-hidden="true"
								></div>
							{/if}

							<!-- Step Node -->
							<div class="relative flex items-center gap-3 sm:flex-col sm:gap-2">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all {isCompleted
										? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
										: isCurrent
											? 'border-[#0A2647] bg-[#0A2647] text-white shadow-xs ring-4 ring-[#0A2647]/15'
											: 'border-slate-300 bg-slate-50 text-slate-400'}"
								>
									{#if isCompleted}
										<Check class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'pending_pick'}
										<Clock class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'ready_dispatch'}
										<PackageCheck class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'in_transit'}
										<Truck class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'distributing'}
										<Send class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'shift_closed'}
										<Archive class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'returns'}
										<RotateCcw class="h-4 w-4" aria-hidden="true" />
									{:else if step.id === 'completed'}
										<CheckCircle2 class="h-4 w-4" aria-hidden="true" />
									{/if}
								</div>

								<!-- Step Text Info -->
								<div class="min-w-0 sm:mt-1">
									<div
										class="text-xs leading-tight font-bold {isCurrent
											? 'text-[#0A2647]'
											: isCompleted
												? 'text-slate-800'
												: 'text-slate-400'}"
									>
										{step.label}
									</div>
									<div
										class="text-2xs leading-normal {isCurrent
											? 'font-medium text-slate-600'
											: 'text-slate-400'}"
									>
										{step.subLabel}
									</div>
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</nav>
		</div>
	{/if}
</div>

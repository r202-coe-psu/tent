<script lang="ts">
	import type { RequisitionTicketStatus } from '../../domain/food-supplies';
	import { getTicketStatusLabel, getTicketStatusBadgeClass } from '../model/ticket-status';
	import Clock from '@lucide/svelte/icons/clock';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Truck from '@lucide/svelte/icons/truck';
	import Send from '@lucide/svelte/icons/send';
	import Archive from '@lucide/svelte/icons/archive';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Ban from '@lucide/svelte/icons/ban';

	interface Props {
		status: RequisitionTicketStatus;
		class?: string;
	}

	let { status, class: className = '' }: Props = $props();

	const label = $derived(getTicketStatusLabel(status));
	const badgeClass = $derived(getTicketStatusBadgeClass(status));
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide {badgeClass} {className}"
	data-status={status}
>
	{#if status === 'PENDING_PICK'}
		<Clock class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'READY_FOR_DISPATCH'}
		<PackageCheck class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'IN_TRANSIT'}
		<Truck class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'DISTRIBUTING'}
		<Send class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'SHIFT_CLOSED'}
		<Archive class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'RETURN_PENDING_RECEIPT'}
		<RotateCcw class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'RETURN_COMPLETED'}
		<CheckCheck class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'COMPLETED'}
		<CheckCircle2 class="h-3 w-3 shrink-0" aria-hidden="true" />
	{:else if status === 'CANCELLED'}
		<Ban class="h-3 w-3 shrink-0" aria-hidden="true" />
	{/if}
	<span>{label}</span>
</span>

<script lang="ts">
	import {
		WORKFLOW_GROUPS,
		type TicketWorkflowGroupId,
		type TicketGroupCounts
	} from '../model/ticket-filters';

	interface Props {
		activeGroup: TicketWorkflowGroupId;
		counts: TicketGroupCounts;
		onSelectGroup: (group: TicketWorkflowGroupId) => void;
	}

	let { activeGroup, counts, onSelectGroup }: Props = $props();
</script>

<div
	class="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200/80 pb-px"
	role="tablist"
>
	{#each WORKFLOW_GROUPS as group (group.id)}
		{@const isActive = activeGroup === group.id}
		{@const count = counts[group.id] ?? 0}
		<button
			type="button"
			role="tab"
			aria-selected={isActive}
			onclick={() => onSelectGroup(group.id)}
			class="group inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-all {isActive
				? 'border-[#0A2647] text-[#0A2647]'
				: 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}"
		>
			<span>{group.label}</span>
			<span
				class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors {isActive
					? 'bg-[#0A2647] text-white'
					: 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'}"
			>
				{count}
			</span>
		</button>
	{/each}
</div>

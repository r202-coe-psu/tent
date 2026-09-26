<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs/index.js';
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

<Tabs.Root
	value={activeGroup}
	onValueChange={(value) => onSelectGroup(value as TicketWorkflowGroupId)}
>
	<Tabs.List
		class="h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-none border-b border-slate-200/80 bg-transparent p-0 pb-px"
	>
		{#each WORKFLOW_GROUPS as group (group.id)}
			{@const isActive = activeGroup === group.id}
			{@const count = counts[group.id] ?? 0}
			<Tabs.Trigger
				value={group.id}
				class="group h-auto flex-none gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-slate-500 shadow-none transition-all hover:border-slate-300 hover:text-slate-800 data-[state=active]:border-[#0A2647] data-[state=active]:bg-transparent data-[state=active]:text-[#0A2647] data-[state=active]:shadow-none"
			>
				<span>{group.label}</span>
				<span
					class="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors {isActive
						? 'bg-[#0A2647] text-white'
						: 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'}"
				>
					{count}
				</span>
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>

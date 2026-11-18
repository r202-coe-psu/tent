<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatThaiDateTime } from '$lib/utils/date';
	import type { AuditEventView } from '../domain/audit-query';
	import {
		AUDIT_ACTION_LABELS,
		auditChangeValue,
		auditEntityLabel,
		auditEventLabel
	} from '../domain/labels';

	let { items, showShelter = false }: { items: AuditEventView[]; showShelter?: boolean } = $props();

	const open = new SvelteSet<string>();

	function toggle(id: string) {
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}

	const hasDetails = (item: AuditEventView) => Boolean(item.changes?.length || item.reason);
</script>

<ul class="divide-y divide-slate-100" data-testid="audit-event-list">
	{#each items as item (item._id)}
		<li class="py-3">
			<div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div class="min-w-0 space-y-0.5">
					<p class="text-sm font-semibold text-slate-900">
						{auditEventLabel(item.event)}
						<span class="font-normal text-slate-500">
							· {auditEntityLabel(item.entity.type)}
							{item.entity.label ?? item.entity.id}
						</span>
					</p>
					<p class="text-xs text-slate-500">
						<span>{item.actor.display_name}</span>
						<span> · {formatThaiDateTime(item.occurred_at)}</span>
						<span> · {AUDIT_ACTION_LABELS[item.action] ?? item.action}</span>
						{#if showShelter && item.shelter_code}
							<span> · {item.shelter_code}</span>
						{/if}
					</p>
				</div>
				{#if hasDetails(item)}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="min-h-11 self-start sm:min-h-9"
						aria-expanded={open.has(item._id)}
						onclick={() => toggle(item._id)}
					>
						รายละเอียด
						<ChevronDown
							class="ml-1 h-4 w-4 transition-transform {open.has(item._id) ? 'rotate-180' : ''}"
						/>
					</Button>
				{/if}
			</div>
			{#if open.has(item._id)}
				<div class="mt-2 space-y-1 rounded-lg border border-slate-200/80 bg-slate-50 p-3 text-sm">
					{#if item.reason}
						<p class="text-slate-700">เหตุผล: {item.reason}</p>
					{/if}
					{#each item.changes ?? [] as change (change.field)}
						<p class="text-slate-700">
							<span class="font-semibold">{change.field}:</span>
							{#if 'from' in change || 'to' in change}
								{auditChangeValue(change.from)} → {auditChangeValue(change.to)}
							{:else}
								มีการแก้ไข
							{/if}
						</p>
					{/each}
				</div>
			{/if}
		</li>
	{/each}
</ul>

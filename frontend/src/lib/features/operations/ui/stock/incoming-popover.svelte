<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Truck from '@lucide/svelte/icons/truck';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import {
		formatIncomingDay,
		incomingCaption,
		incomingRowHref,
		INCOMING_SOURCE_LABEL,
		type StockRowBase
	} from './stock-view';

	let {
		row,
		unitLabel,
		roles = []
	}: {
		row: Pick<StockRowBase, 'name' | 'qtyOnHand' | 'incoming'>;
		unitLabel: string;
		/** Decides which rows get a link: only pages the user may open. */
		roles?: readonly string[];
	} = $props();

	const caption = $derived(incomingCaption(row));
	const lines = $derived(row.incoming?.rows ?? []);
</script>

{#if caption && row.incoming}
	<Popover.Root>
		<Popover.Trigger
			class="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded text-left text-xs font-semibold text-sky-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none md:min-h-8"
			aria-label="รายการของที่กำลังมา {row.name}"
			onclick={(e: MouseEvent) => e.stopPropagation()}
		>
			<Truck class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			<span class="tabular-nums">{caption}</span>
		</Popover.Trigger>
		<Popover.Content align="start" class="w-80 max-w-[calc(100vw-2rem)] gap-2 p-3">
			<h4 class="text-sm font-semibold text-slate-900">ของที่กำลังมา · {row.name}</h4>
			<ul class="divide-y divide-slate-100">
				{#each lines as line, i (`${line.source}:${line.doc_id}:${i}`)}
					{@const href = incomingRowHref(line, roles)}
					<li class="flex items-start justify-between gap-3 py-2 text-sm">
						<div class="min-w-0 space-y-0.5">
							<p class="flex flex-wrap items-center gap-1.5">
								<span
									class="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
								>
									{INCOMING_SOURCE_LABEL[line.source]}
								</span>
								{#if line.overdue}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
									>
										<TriangleAlert class="h-3 w-3" aria-hidden="true" />
										เลยกำหนด
									</span>
								{/if}
							</p>
							<p class="truncate font-semibold text-slate-900">{line.ref}</p>
							<p class="text-xs text-slate-500 tabular-nums">
								{line.date ? formatIncomingDay(line.date) : 'ยังไม่ระบุวัน'}
							</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="font-bold text-slate-900 tabular-nums">
								{line.qty}
								<span class="text-xs font-normal text-slate-500">{unitLabel}</span>
							</p>
							{#if href}
								<a
									href={resolve(href as '/back-office/supply')}
									class="inline-flex min-h-11 items-center gap-1 rounded text-xs font-semibold text-sky-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none md:min-h-8"
								>
									ดูใบ
									<ExternalLink class="h-3 w-3" aria-hidden="true" />
								</a>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
{/if}

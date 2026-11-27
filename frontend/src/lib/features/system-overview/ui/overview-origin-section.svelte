<script lang="ts">
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { OriginBucket } from '../domain/schemas';

	let {
		buckets,
		loading = false
	}: {
		buckets: OriginBucket[] | undefined;
		loading?: boolean;
	} = $props();

	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));
</script>

<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header>
		<Card.Title class="text-lg font-bold text-slate-900">{t.originTitle}</Card.Title>
		<Card.Description class="text-sm text-slate-500">
			{t.originDescription}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if loading && !buckets}
			<Skeleton class="h-40 w-full rounded-xl" />
		{:else if !buckets || buckets.length === 0}
			<p class="py-6 text-center text-sm text-slate-500">{t.originEmpty}</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-200/80">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{t.province}</Table.Head>
							<Table.Head>{t.district}</Table.Head>
							<Table.Head>{t.subdistrict}</Table.Head>
							<Table.Head>{t.originShelter}</Table.Head>
							<Table.Head class="text-right">{t.count}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each buckets as row, i (`${row.province}|${row.district}|${row.subdistrict}|${row.shelter_code}|${i}`)}
							<Table.Row>
								<Table.Cell class="font-medium text-slate-900">{row.province}</Table.Cell>
								<Table.Cell class="text-slate-700">{row.district ?? '—'}</Table.Cell>
								<Table.Cell class="text-slate-700">{row.subdistrict ?? '—'}</Table.Cell>
								<Table.Cell class="text-slate-700"
									>{row.shelter_code ?? t.source.unassigned}</Table.Cell
								>
								<Table.Cell class="text-right font-semibold text-slate-900 tabular-nums">
									{row.count}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<script lang="ts">
	/**
	 * Shared shadcn Pagination wrapper — bindable page, hides when only one page.
	 */
	import * as Pagination from '$lib/components/ui/pagination/index.js';

	let {
		page = $bindable(1),
		count,
		perPage = 10
	}: {
		page?: number;
		count: number;
		perPage?: number;
	} = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));
</script>

{#if totalPages > 1}
	<Pagination.Root bind:page {count} {perPage}>
		{#snippet children({ pages })}
			<Pagination.Content>
				<Pagination.Previous />
				{#each pages as p, i (i)}
					<Pagination.Item>
						{#if p.type === 'page'}
							<Pagination.Link page={p} isActive={p.value === page} />
						{:else}
							<Pagination.Ellipsis />
						{/if}
					</Pagination.Item>
				{/each}
				<Pagination.Next />
			</Pagination.Content>
		{/snippet}
	</Pagination.Root>
{/if}

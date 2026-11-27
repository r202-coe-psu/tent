<script lang="ts">
	/**
	 * Shared shadcn Pagination wrapper — bindable page, hides when only one page.
	 * Prev/next labels follow the app language (Thai by default, English when `en`).
	 */
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils/shadcn.js';
	import { langState } from '$lib/states/i18n.svelte';

	const LABELS = {
		th: {
			previous: 'ก่อนหน้า',
			next: 'ถัดไป',
			previousAria: 'ไปหน้าก่อนหน้า',
			nextAria: 'ไปหน้าถัดไป'
		},
		en: {
			previous: 'Previous',
			next: 'Next',
			previousAria: 'Go to previous page',
			nextAria: 'Go to next page'
		}
	} as const;

	let {
		page = $bindable(1),
		count,
		perPage = 10,
		class: className
	}: {
		page?: number;
		count: number;
		perPage?: number;
		/** Extra classes for the prev/next/page buttons (e.g. `h-7 text-xs` for compact footers). */
		class?: string;
	} = $props();

	const labels = $derived(LABELS[langState.current === 'en' ? 'en' : 'th']);

	const totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));
</script>

{#if totalPages > 1}
	<Pagination.Root bind:page {count} {perPage}>
		{#snippet children({ pages })}
			<Pagination.Content>
				<PaginationPrimitive.PrevButton
					aria-label={labels.previousAria}
					class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pl-1.5!', className)}
				>
					<ChevronLeftIcon data-icon="inline-start" />
					<span class="hidden sm:block">{labels.previous}</span>
				</PaginationPrimitive.PrevButton>
				{#each pages as p (p.key)}
					<Pagination.Item>
						{#if p.type === 'page'}
							<Pagination.Link page={p} isActive={p.value === page} class={className} />
						{:else}
							<Pagination.Ellipsis class={className} />
						{/if}
					</Pagination.Item>
				{/each}
				<PaginationPrimitive.NextButton
					aria-label={labels.nextAria}
					class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pr-1.5!', className)}
				>
					<span class="hidden sm:block">{labels.next}</span>
					<ChevronRightIcon data-icon="inline-end" />
				</PaginationPrimitive.NextButton>
			</Pagination.Content>
		{/snippet}
	</Pagination.Root>
{/if}

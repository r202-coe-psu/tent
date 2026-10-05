<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';
	import Info from '@lucide/svelte/icons/info';

	interface Props {
		/** Accessible name for the trigger button (e.g. "คำอธิบาย: รับเข้ารวม"). */
		label: string;
		/** Short heading shown at the top of the popover content. */
		title?: string;
		class?: string;
		contentClass?: string;
		children: Snippet;
	}

	let { label, title, class: className, contentClass, children }: Props = $props();
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={label}
				class={cn('shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700', className)}
			>
				<Info class="h-3.5 w-3.5" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class={cn('w-64 text-xs', contentClass)}>
		{#if title}
			<p class="font-bold text-slate-900">{title}</p>
		{/if}
		<p class="text-slate-600">
			{@render children()}
		</p>
	</Popover.Content>
</Popover.Root>

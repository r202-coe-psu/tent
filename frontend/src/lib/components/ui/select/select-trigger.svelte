<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils/shadcn.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: 'sm' | 'default';
	} = $props();
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Tab' && !e.shiftKey) {
			const trigger = (e.currentTarget as HTMLElement | null) ?? ref;
			const isOpen =
				trigger?.getAttribute('data-state') === 'open' ||
				trigger?.getAttribute('aria-expanded') === 'true';
			if (isOpen) {
				const activeId = trigger?.getAttribute('aria-activedescendant');
				const highlighted =
					(activeId ? document.getElementById(activeId) : null) ??
					document.querySelector<HTMLElement>(
						'[data-slot="select-content"] [data-slot="select-item"][data-highlighted]'
					) ??
					document.querySelector<HTMLElement>(
						'[data-slot="select-content"] [data-slot="select-item"][data-state="checked"]'
					);
				if (highlighted) {
					highlighted.click();
				}
			}
		}
		restProps.onkeydown?.(e as never);
	}
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	onkeydown={handleKeydown}
	class={cn(
		"flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-white py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ChevronDownIcon class="pointer-events-none size-4 text-muted-foreground" />
</SelectPrimitive.Trigger>

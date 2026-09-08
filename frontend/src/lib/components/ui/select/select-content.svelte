<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import SelectPortal from './select-portal.svelte';
	import SelectScrollUpButton from './select-scroll-up-button.svelte';
	import SelectScrollDownButton from './select-scroll-down-button.svelte';
	import { cn, type WithoutChild } from '$lib/utils/shadcn.js';
	import type { ComponentProps } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils/shadcn.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 6,
		portalProps,
		children,
		preventScroll = true,
		...restProps
	}: WithoutChild<SelectPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SelectPortal>>;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Tab' && !e.shiftKey) {
			const container = e.currentTarget as HTMLElement;
			const highlighted =
				container?.querySelector<HTMLElement>('[data-slot="select-item"][data-highlighted]') ??
				container?.querySelector<HTMLElement>('[data-slot="select-item"][data-state="checked"]');
			if (highlighted) {
				highlighted.click();
			}
		}
		restProps.onkeydown?.(e as never);
	}
</script>

<SelectPortal {...portalProps}>
	<SelectPrimitive.Content
		bind:ref
		{sideOffset}
		{preventScroll}
		onkeydown={handleKeydown}
		data-slot="select-content"
		class={cn(
			'relative isolate z-50 max-w-[calc(100vw-2rem)] min-w-36 min-w-[var(--bits-select-anchor-width)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border/80 duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
			className
		)}
		{...restProps}
	>
		<SelectScrollUpButton />
		<SelectPrimitive.Viewport
			class={cn(
				'max-h-80 w-full min-w-[var(--bits-select-anchor-width)] scroll-my-1 overflow-x-hidden overflow-y-auto p-1.5'
			)}
		>
			{@render children?.()}
		</SelectPrimitive.Viewport>
		<SelectScrollDownButton />
	</SelectPrimitive.Content>
</SelectPortal>

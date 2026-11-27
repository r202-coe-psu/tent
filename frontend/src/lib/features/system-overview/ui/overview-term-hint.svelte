<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	/** Info icon placed after a term; the tooltip explains how the number is counted. */
	let { text, label }: { text: string; label: string } = $props();
</script>

<Tooltip.Provider delayDuration={150}>
	<Tooltip.Root>
		<Tooltip.Trigger
			type="button"
			class="inline-flex shrink-0 cursor-help items-center rounded-sm align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label={label}
		>
			<Info class="size-3.5" aria-hidden="true" />
		</Tooltip.Trigger>
		<!-- Same look as the app's popovers: white surface, dark text, hairline ring + soft shadow
			(the default tooltip is solid navy). The arrow is hidden — it is navy-only. -->
		<Tooltip.Content
			class="max-w-xs rounded-lg bg-popover p-3 text-left text-sm font-normal text-popover-foreground shadow-md ring-1 ring-foreground/10"
			arrowClasses="hidden"
		>
			{text}
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>

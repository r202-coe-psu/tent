<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	let {
		reason,
		class: className = '',
		children
	}: {
		/** Why the wrapped control is disabled; nothing is wrapped while it is unset. */
		reason?: string;
		class?: string;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const reasonId = `${uid}-reason`;
</script>

{#if reason}
	<!-- A disabled shadcn Button has `pointer-events: none` and no tab stop: it never sees the
		hover or focus that opens a tooltip, and a click on it falls through to whatever is
		underneath (a clickable stock row). This wrapper stands in for it as a disabled control —
		it takes the hover/focus for the tooltip, names the reason for screen readers, and stops
		the click (#572). -->
	<Tooltip.Provider delayDuration={150}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<!-- `group`, not `button`: the real button inside keeps the control's name and role. It
						still takes a tab stop, the only way a keyboard user reaches the reason. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<span
						{...props}
						role="group"
						tabindex="0"
						aria-disabled="true"
						aria-describedby={reasonId}
						class="flex cursor-not-allowed flex-col rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {className}"
						onclick={(e: MouseEvent) => e.stopPropagation()}
					>
						{@render children()}
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{reason}</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
	<span id={reasonId} class="sr-only">{reason}</span>
{:else}
	{@render children()}
{/if}

<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Never colour alone: the icon and the words carry it too. */
		tone: 'warning' | 'success';
		icon: Component<{ class?: string }>;
		children: Snippet;
	}

	let { tone, icon: Icon, children, class: className, ...rest }: Props = $props();
</script>

<!-- One line the person must not miss inside a kiosk step: same size on every screen. -->
<div
	{...rest}
	class={[
		'mx-auto flex max-w-xl items-center justify-center gap-3 rounded-xl border p-3 text-left text-lg font-bold kiosk-portrait:max-w-2xl kiosk-portrait:p-4 kiosk-portrait:text-2xl kiosk-compact:p-1.5 kiosk-compact:text-base kiosk-compact:leading-tight',
		tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-950',
		tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-950',
		className
	]}
>
	<span class="flex shrink-0" aria-hidden="true"><Icon class="size-6 kiosk-portrait:size-8" /></span
	>
	<p>{@render children()}</p>
</div>

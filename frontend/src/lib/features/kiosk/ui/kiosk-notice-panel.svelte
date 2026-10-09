<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (data-testid, data-*) land on the panel's root. */
	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'role' | 'children'> {
		/** Never colour alone: the icon and the title say the same thing. */
		tone: 'info' | 'warning' | 'success' | 'critical';
		icon: Component<{ class?: string }>;
		title: string;
		/** h1 when the panel is the whole page; under a page h1 it stays h2. */
		headingTag?: 'h1' | 'h2';
		/** alert for something that went wrong, status otherwise. */
		role?: 'alert' | 'status';
		/** Already inside a card (the face check): no frame of its own, same contents and sizes. */
		bare?: boolean;
		children?: Snippet;
		/** Buttons built with KIOSK_NOTICE_PRIMARY_ACTION / KIOSK_NOTICE_SECONDARY_ACTION. */
		actions?: Snippet;
	}

	let {
		tone,
		icon: Icon,
		title,
		headingTag = 'h2',
		role,
		bare = false,
		children,
		actions,
		...rest
	}: Props = $props();

	const id = $props.id();
</script>

<!--
	The one card for every message a kiosk step ends on (register here, already registered, search
	failed, done): same size, same type scale and same buttons wherever it appears.
-->
<section
	{...rest}
	class={[
		'no-print text-center',
		!bare &&
			'mx-auto w-full max-w-3xl rounded-2xl border bg-white p-6 shadow-2xs sm:p-8 kiosk-portrait:p-10 kiosk-compact:p-4',
		!bare && tone === 'info' && 'border-sky-200',
		!bare && tone === 'warning' && 'border-amber-200',
		!bare && tone === 'success' && 'border-emerald-200',
		!bare && tone === 'critical' && 'border-red-200'
	]}
	aria-labelledby={`${id}-title`}
	{role}
>
	<div
		class={[
			'mx-auto flex size-16 items-center justify-center rounded-full border kiosk-portrait:size-24 kiosk-compact:hidden',
			tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
			tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
			tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
			tone === 'critical' && 'border-red-200 bg-red-50 text-red-900'
		]}
		aria-hidden="true"
	>
		<Icon class="size-8 kiosk-portrait:size-12" />
	</div>
	<svelte:element
		this={headingTag}
		id={`${id}-title`}
		class={[
			'mt-4 text-2xl font-bold kiosk-portrait:mt-6 kiosk-portrait:text-4xl kiosk-compact:mt-0 kiosk-compact:text-xl',
			headingTag === 'h1' ? 'text-[#0A2647]' : 'text-slate-900'
		]}
	>
		{title}
	</svelte:element>
	{#if children}
		<div
			class="mx-auto mt-2 max-w-xl space-y-3 text-lg leading-relaxed text-slate-700 kiosk-portrait:mt-4 kiosk-portrait:max-w-2xl kiosk-portrait:text-2xl kiosk-compact:text-base"
		>
			{@render children()}
		</div>
	{/if}
	{#if actions}
		<div
			class="mx-auto mt-6 flex max-w-md flex-col gap-3 kiosk-portrait:mt-10 kiosk-portrait:max-w-xl kiosk-portrait:gap-4 kiosk-compact:mt-4"
		>
			{@render actions()}
		</div>
	{/if}
</section>

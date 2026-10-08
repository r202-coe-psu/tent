<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import KioskNumpad from './kiosk-numpad.svelte';

	interface Props {
		value?: string;
		maxLength: number;
		disabled?: boolean;
		/** Enter on a keyboard, same as the main button. */
		onsubmit?: () => void;
		/** Accessible name: the id of a heading inside `header`, or a plain label. */
		labelledby?: string;
		label?: string;
		class?: ClassValue;
		testid?: string;
		/** Title / one line of explanation. */
		header?: Snippet;
		/** What has been typed (an `<output>`). */
		display: Snippet;
		/** The main button(s) under the keys. */
		actions: Snippet;
		/** Status / hint lines; give the small note the `kiosk-numpad-panel-note` class. */
		footer?: Snippet;
	}

	let {
		value = $bindable(''),
		maxLength,
		disabled = false,
		onsubmit,
		labelledby,
		label,
		class: className,
		testid,
		header,
		display,
		actions,
		footer
	}: Props = $props();
</script>

<!--
	One layout for every number entry on the kiosk (phone number, staff PIN): title → explanation →
	value → keys → main button → status line, with the same key sizes on short screens and on the
	24" portrait screen, so the two never drift apart.
-->
<section
	class={[
		'numpad-panel mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-2 kiosk-portrait:max-w-xl kiosk-portrait:flex-none kiosk-portrait:gap-5',
		className
	]}
	aria-labelledby={labelledby}
	aria-label={labelledby ? undefined : label}
	data-testid={testid}
>
	{@render header?.()}
	{@render display()}
	<div class="numpad-panel-keys flex min-h-0 flex-1 flex-col">
		<KioskNumpad bind:value {maxLength} {disabled} {onsubmit} />
	</div>
	<div class="numpad-panel-actions flex flex-col gap-2 kiosk-portrait:gap-3">
		{@render actions()}
	</div>
	{@render footer?.()}
</section>

<style>
	.numpad-panel-keys :global([role='group']) {
		flex: 1;
		grid-template-rows: repeat(4, minmax(3rem, 1fr));
	}

	.numpad-panel-keys :global(button) {
		height: 100%;
	}

	@media (max-height: 650px) {
		.numpad-panel {
			gap: 0.25rem;
		}

		.numpad-panel :global(header p) {
			margin-top: 0;
			font-size: 0.875rem;
			line-height: 1.25;
		}

		.numpad-panel :global(output) {
			min-height: 2.75rem;
			font-size: 1.25rem;
		}

		.numpad-panel-keys :global(button) {
			min-height: 3rem;
			height: 100%;
		}

		.numpad-panel-keys :global(button[aria-label^='ตัวเลข']) {
			font-size: 1.5rem;
		}

		.numpad-panel-actions :global(button) {
			min-height: 2.75rem;
		}

		.numpad-panel :global(.kiosk-numpad-panel-note) {
			font-size: 0.75rem;
			line-height: 1.2;
		}
	}

	/* 24" portrait: a fixed-size numpad (5.5rem keys, ~2:1) instead of stretching to the screen. */
	@media screen and (orientation: portrait) and (min-height: 1200px) {
		/* Button forces svg to size-4 unless the class list mentions "size-", which would also
		   resize the landscape icons — so icons are scaled here instead (specificity beats it). */
		.numpad-panel-actions :global(button svg),
		.numpad-panel-keys :global(button svg) {
			width: 1.5rem;
			height: 1.5rem;
		}

		.numpad-panel-keys {
			flex: none;
		}

		.numpad-panel-keys :global([role='group']) {
			flex: none;
			grid-template-rows: repeat(4, 5.5rem);
			gap: 0.75rem;
		}

		.numpad-panel-keys :global(button) {
			border-width: 2px;
			border-radius: 0.75rem;
		}

		.numpad-panel-keys :global(button[aria-label^='ตัวเลข']) {
			font-size: 2.5rem;
			line-height: 1;
		}

		.numpad-panel-keys :global(button:not([aria-label^='ตัวเลข'])) {
			font-size: 1.25rem;
			line-height: 1.4;
		}
	}
</style>

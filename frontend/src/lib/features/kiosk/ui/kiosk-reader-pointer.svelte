<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';

	interface Props {
		/** Which bottom corner of the screen the physical reader sits under. */
		side: 'left' | 'right';
		label: string;
	}

	let { side, label }: Props = $props();
</script>

<!--
	Points at a reader that sits below the screen edge (hidden on the compact 10.1" panel) (ID-card slot at the bottom left, QR reader at
	the bottom right). Pinned to the viewport corner so it stays over the real hardware wherever the
	page content is centred.
-->
<div
	class={[
		'pointer-events-none fixed bottom-[calc(var(--testing-banner-height)+0.25rem)] z-10 flex flex-col items-center gap-1 kiosk-compact:hidden',
		side === 'left' ? 'left-14 kiosk-portrait:left-28' : 'right-14 kiosk-portrait:right-28'
	]}
	data-reader-side={side}
>
	<span
		class="rounded-full bg-[#0A2647] px-3 py-1 text-sm font-bold text-white kiosk-portrait:px-5 kiosk-portrait:py-2 kiosk-portrait:text-xl"
		>{label}</span
	>
	<span class="reader-arrow size-10 text-[#0A2647] kiosk-portrait:size-20" aria-hidden="true"
		><ArrowDown class="size-full" strokeWidth={3} /></span
	>
</div>

<style>
	.reader-arrow {
		animation: nudge 1s ease-in-out infinite;
	}

	@keyframes nudge {
		50% {
			transform: translateY(0.5rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.reader-arrow {
			animation: none;
		}
	}
</style>

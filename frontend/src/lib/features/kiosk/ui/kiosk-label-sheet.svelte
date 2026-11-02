<script lang="ts">
	import {
		KIOSK_LABEL_MM,
		KIOSK_LABEL_OFFSET_X_MM,
		kioskLabelPageCss
	} from '../domain/print-label';
	import type { KioskLabelSheetItem } from '../domain/kiosk-label-item';
	import KioskLabelCard from './kiosk-label-card.svelte';

	interface Props {
		labels: readonly KioskLabelSheetItem[];
	}

	let { labels }: Props = $props();

	// Print labels must be a direct child of <body> so print CSS can drop the whole kiosk screen with
	// display:none; visibility:hidden keeps its layout height and prints blank labels.
	function mountOnBody(node: HTMLElement) {
		document.body.appendChild(node);
		return () => node.remove();
	}
</script>

<svelte:head>
	<!-- Static CSS built from KIOSK_LABEL_MM constants only (no user input). -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html `<style>${kioskLabelPageCss()}</style>`}
</svelte:head>

<!-- The wrapper stays in place for Svelte's DOM bookkeeping; its child is moved to <body>. -->
<div hidden>
	<div
		class="kiosk-print-area"
		aria-hidden="true"
		style:--label-width="{KIOSK_LABEL_MM.width}mm"
		style:--label-height="{KIOSK_LABEL_MM.height}mm"
		style:--label-offset-x="{KIOSK_LABEL_OFFSET_X_MM}mm"
		{@attach mountOnBody}
	>
		{#each labels as label (label.key)}
			<div class="wristband">
				<KioskLabelCard {label} />
			</div>
		{/each}
	</div>
</div>

<style>
	.kiosk-print-area {
		display: none;
	}

	/* Label size comes from domain/print-label.ts (CSS vars + generated @page in <svelte:head>). */
	@media print {
		:global(body) {
			margin: 0 !important;
		}
		:global(body > :not(.kiosk-print-area)) {
			display: none !important;
		}
		.kiosk-print-area {
			display: block;
		}
		.wristband {
			box-sizing: border-box;
			display: block;
			width: var(--label-width);
			height: var(--label-height);
			translate: var(--label-offset-x) 0;
			overflow: hidden;
			break-after: page;
			break-inside: avoid;
		}
		.wristband:last-child {
			break-after: auto;
		}
	}
</style>

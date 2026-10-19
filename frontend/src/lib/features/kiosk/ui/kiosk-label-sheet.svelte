<script lang="ts" module>
	export type KioskLabelSheetItem = {
		key: string;
		/** QR data URL; the card shows its placeholder while this is still being prepared. */
		qrSrc: string | undefined;
		qrSizeMm: number | undefined;
		name: string;
		/** Current zone name; missing or null leaves a dotted line to write the zone on. */
		zone?: string | null;
		/** Intake stations passed: this many checklist boxes are ticked. */
		checkedCount?: number;
	};
</script>

<script lang="ts">
	import QrIdCard from '$lib/components/qr-id-card.svelte';
	import {
		KIOSK_LABEL_CHECKLIST,
		KIOSK_LABEL_GAP_MM,
		KIOSK_LABEL_LINK,
		KIOSK_LABEL_MM,
		KIOSK_LABEL_OFFSET_X_MM,
		KIOSK_LABEL_PADDING_MM,
		kioskLabelPageCss,
		kioskQrBoxMm,
		labelZoneLine
	} from '../domain/print-label';

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
		style:--label-padding="{KIOSK_LABEL_PADDING_MM}mm"
		style:--label-offset-x="{KIOSK_LABEL_OFFSET_X_MM}mm"
		style:--label-gap="{KIOSK_LABEL_GAP_MM}mm"
		{@attach mountOnBody}
	>
		{#each labels as label (label.key)}
			<div class="wristband" style:--qr-size="{label.qrSizeMm ?? kioskQrBoxMm()}mm">
				<QrIdCard
					src={label.qrSrc}
					alt="QR ประจำตัวสำหรับใช้ภายในศูนย์"
					name={label.name}
					zone={labelZoneLine(label.zone)}
					checkedCount={label.checkedCount}
					footer={KIOSK_LABEL_LINK}
					checklist={KIOSK_LABEL_CHECKLIST}
				/>
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
			padding: var(--label-padding);
			translate: var(--label-offset-x) 0;
			overflow: hidden;
			break-after: page;
			break-inside: avoid;
			font-family: 'IBM Plex Sans Thai', sans-serif;
			color: #000;
		}
		.wristband:last-child {
			break-after: auto;
		}
	}
</style>

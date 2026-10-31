<script lang="ts">
	import type { VolunteerLabelSheet } from '../application/volunteer-label-print';
	import {
		KIOSK_LABEL_DIVIDER_MM,
		KIOSK_LABEL_GAP_MM,
		KIOSK_LABEL_LINK,
		KIOSK_LABEL_MM,
		KIOSK_LABEL_OFFSET_X_MM,
		KIOSK_LABEL_PADDING_MM,
		kioskLabelPageCss
	} from '../domain/print-label';
	import { VOLUNTEER_LABEL_TEXT } from '../domain/volunteer-label';

	interface Props {
		/** What to print; `null` while nothing is being printed. */
		sheet: VolunteerLabelSheet | null;
	}

	let { sheet }: Props = $props();

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

{#if sheet}
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
			style:--label-divider="{KIOSK_LABEL_DIVIDER_MM}mm"
			style:--name-pt="{VOLUNTEER_LABEL_TEXT.name.pt}pt"
			style:--name-line={VOLUNTEER_LABEL_TEXT.name.lineHeight}
			style:--name-lines={VOLUNTEER_LABEL_TEXT.name.maxLines}
			style:--badge-pt="{VOLUNTEER_LABEL_TEXT.badge.pt}pt"
			style:--badge-line={VOLUNTEER_LABEL_TEXT.badge.lineHeight}
			style:--link-pt="{VOLUNTEER_LABEL_TEXT.link.pt}pt"
			{@attach mountOnBody}
		>
			<div class="volunteer-label">
				<div class="text">
					<p class="name">{sheet.name}</p>
					<p class="badge">{sheet.badge}</p>
					<p class="link">{KIOSK_LABEL_LINK}</p>
				</div>
				<img class="qr" src={sheet.qrSrc} alt="QR จิตอาสา" style:width="{sheet.qrSizeMm}mm" />
			</div>
		</div>
	</div>
{/if}

<style>
	.kiosk-print-area {
		display: none;
	}

	/* `body:where(:has(...))` keeps these global rules inert on pages without this print area
	   (:where adds no specificity); otherwise they hide other print pages (#1057). */
	/* Label size comes from domain/print-label.ts (CSS vars + generated @page in <svelte:head>). */
	@media print {
		:global(body:where(:has(.kiosk-print-area))) {
			margin: 0 !important;
		}
		:global(body:where(:has(.kiosk-print-area)) > :not(.kiosk-print-area)) {
			display: none !important;
		}
		.kiosk-print-area {
			display: block;
		}
		.volunteer-label {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--label-gap);
			width: var(--label-width);
			height: var(--label-height);
			padding: var(--label-padding);
			translate: var(--label-offset-x) 0;
			overflow: hidden;
			break-inside: avoid;
			font-family: 'IBM Plex Sans Thai', sans-serif;
			color: #000;
		}
		.text {
			display: flex;
			flex: 1;
			flex-direction: column;
			align-self: stretch;
			min-width: 0;
			padding-right: var(--label-gap);
			border-right: var(--label-divider) solid #000;
		}
		.name {
			margin: 0;
			font-size: var(--name-pt);
			font-weight: 700;
			line-height: var(--name-line);
			overflow-wrap: anywhere;
			display: -webkit-box;
			-webkit-line-clamp: var(--name-lines);
			line-clamp: var(--name-lines);
			-webkit-box-orient: vertical;
			overflow: hidden;
		}
		.badge {
			margin: 0;
			font-size: var(--badge-pt);
			font-weight: 700;
			line-height: var(--badge-line);
		}
		.link {
			margin: auto 0 0;
			font-size: var(--link-pt);
			font-weight: 500;
			line-height: 1.3;
		}
		.qr {
			flex: none;
			display: block;
		}
	}
</style>

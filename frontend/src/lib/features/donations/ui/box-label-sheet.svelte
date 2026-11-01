<script lang="ts">
	import { formatUnit, type UnitOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import {
		BOX_LABEL_MAX_LINES,
		BOX_LABEL_MM,
		clipLabelLines,
		type BoxLabel
	} from '../domain/box-label';
	import { deliveryMethodLabel } from '../domain/tracking';

	let {
		label,
		qrSrc,
		units = []
	}: {
		label: BoxLabel;
		/** QR image of `label.qrValue`; the box stays blank until it is ready. */
		qrSrc: string;
		units?: readonly UnitOfMeasure[];
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const locale = $derived(langState.current === 'en' ? 'en-US' : 'th-TH');

	const clipped = $derived(clipLabelLines(label.lines, BOX_LABEL_MAX_LINES));
	const point = $derived(label.destination);
	const showShelterName = $derived(point.shelterName !== point.name);
	const coordinates = $derived(
		point.geo ? `${point.geo.lat.toFixed(5)}, ${point.geo.lng.toFixed(5)}` : null
	);

	function qtyText(qty: string | number | null): string {
		if (qty == null || qty === '') return '';
		const n = Number(qty);
		return Number.isFinite(n) ? n.toLocaleString(locale) : String(qty);
	}
</script>

<article
	class="label"
	style:--label-width="{BOX_LABEL_MM.width}mm"
	style:--label-height="{BOX_LABEL_MM.height}mm"
	data-testid="box-label"
	data-qr-value={label.qrValue}
>
	<header class="destination">
		<p class="kicker">{t.boxLabelDeliverTo}</p>
		<h2 class="dest-name">{point.name}</h2>
		{#if showShelterName}
			<p class="dest-sub">{point.shelterName}</p>
		{/if}
		{#if point.address}
			<p class="dest-address">{point.address}</p>
		{/if}
		{#if point.note}
			<p class="dest-address">{point.note}</p>
		{/if}
		{#if coordinates}
			<p class="dest-geo">{t.boxLabelCoordinates} {coordinates}</p>
		{/if}
	</header>

	<section class="ref-row">
		<div class="qr-box">
			{#if qrSrc}
				<img class="qr" src={qrSrc} alt={t.boxLabelQrAlt.replace('{ref}', label.bookingRef)} />
			{/if}
		</div>
		<div class="ref-text">
			<p class="kicker">{t.boxLabelRefTitle}</p>
			<p class="ref-no" data-testid="box-label-ref">{label.bookingRef}</p>
			<p class="meta">
				<span class="meta-key">{t.boxLabelMethodTitle}</span>
				{deliveryMethodLabel(label.deliveryMethod, langState.current)}
			</p>
			{#if label.schedule}
				<p class="meta">
					<span class="meta-key">{t.boxLabelScheduleTitle}</span>
					{label.schedule}
				</p>
			{/if}
		</div>
	</section>

	<section class="items">
		<p class="kicker">{t.boxLabelItemsTitle}</p>
		<ul class="item-list" data-testid="box-label-items">
			{#each clipped.shown as line, i (line.name + String(i))}
				<li class="item-row">
					<span class="item-name">{line.name}</span>
					<span class="item-qty">
						{qtyText(line.qty)}
						{line.unit ? formatUnit(line.unit, units, langState.current) : ''}
					</span>
				</li>
			{/each}
			{#if clipped.hidden > 0}
				<li class="item-row item-more">
					{t.boxLabelMoreItems.replace('{count}', String(clipped.hidden))}
				</li>
			{/if}
		</ul>
	</section>

	<footer class="foot">
		<span>{t.boxLabelScanHint}</span>
		{#if label.sheet.total > 1}
			<span class="sheet-no">
				{t.boxLabelSheetOf
					.replace('{index}', String(label.sheet.index))
					.replace('{total}', String(label.sheet.total))}
			</span>
		{/if}
	</footer>
</article>

<style>
	/* mm and pt, not rem: this is paper, so it must not follow the viewport or root font size. */
	.label {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 3mm;
		width: var(--label-width);
		height: var(--label-height);
		padding: 5.5mm;
		overflow: hidden;
		color: #000;
		background: #fff;
		break-after: page;
		break-inside: avoid;
	}
	.label:last-child {
		break-after: auto;
	}
	.kicker {
		margin: 0;
		font-size: 7.5pt;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.destination {
		padding-bottom: 3mm;
		border-bottom: 0.4mm solid #000;
	}
	.dest-name {
		margin: 1mm 0 0;
		font-size: 15pt;
		font-weight: 800;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.dest-sub {
		margin: 0.5mm 0 0;
		font-size: 9pt;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.dest-address,
	.dest-geo {
		margin: 1mm 0 0;
		font-size: 8.5pt;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.dest-geo {
		font-size: 7.5pt;
	}
	.ref-row {
		display: flex;
		gap: 4mm;
		align-items: center;
	}
	.qr-box {
		flex: none;
		width: 30mm;
		height: 30mm;
	}
	.qr {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	.ref-text {
		min-width: 0;
		flex: 1;
	}
	.ref-no {
		margin: 0.5mm 0 1.5mm;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
		font-size: 17pt;
		font-weight: 800;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.meta {
		margin: 0.5mm 0 0;
		font-size: 8.5pt;
		line-height: 1.3;
	}
	.meta-key {
		font-weight: 700;
	}
	.meta-key::after {
		content: ':';
	}
	.items {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding-top: 2.5mm;
		border-top: 0.4mm solid #000;
	}
	.item-list {
		margin: 1mm 0 0;
		padding: 0;
		overflow: hidden;
		list-style: none;
	}
	.item-row {
		display: flex;
		gap: 3mm;
		justify-content: space-between;
		padding: 0.9mm 0;
		border-bottom: 0.2mm dotted #666;
		font-size: 9.5pt;
		line-height: 1.25;
	}
	.item-name {
		min-width: 0;
		overflow: hidden;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.item-qty {
		flex: none;
		font-weight: 700;
	}
	.item-more {
		justify-content: flex-start;
		font-style: italic;
		border-bottom: 0;
	}
	.foot {
		display: flex;
		justify-content: space-between;
		font-size: 7pt;
	}
	.sheet-no {
		font-weight: 700;
	}
</style>

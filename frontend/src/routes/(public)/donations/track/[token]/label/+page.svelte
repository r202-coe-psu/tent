<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Printer from '@lucide/svelte/icons/printer';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import { generateQrDataUrl, qrModuleCount } from '$lib/utils/qrcode';
	import {
		BoxLabelSheet,
		boxLabelPageCss,
		buildBoxLabels,
		canPrintBoxLabel,
		hasLinePoints,
		lineDestinationResolver,
		resolveDropOffPoint,
		useDonationTracking,
		withCurrentLinePoints
	} from '$lib/features/donations';
	import { PublicPageShell, usePublicShelter } from '$lib/features/public-portal';
	import { useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	let { data }: { data: { token: string } } = $props();
	const token = $derived(data.token);
	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	const trackingQuery = useDonationTracking(() => token);
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	const donation = $derived(trackingQuery.data);
	const printable = $derived(donation ? canPrintBoxLabel(donation.status) : false);

	// A failed lookup leaves the shelter code on the label instead of blocking the print.
	const shelterQuery = usePublicShelter(() =>
		printable ? (donation?.shelter_code ?? null) : null
	);
	const shelterPending = $derived(printable && shelterQuery.isPending);

	const labels = $derived.by(() => {
		if (!donation || shelterPending) return [];
		const shelter = shelterQuery.data ?? {
			code: donation.shelter_code,
			name: donation.shelter_code
		};
		if (!hasLinePoints(donation.items)) {
			return buildBoxLabels(donation, () => resolveDropOffPoint(shelter));
		}
		// CR-206 FR-MP-14 — one label per point. A point the shelter no longer offers reads as no
		// point, so those lines share one "any point" label with the shelter address (FR-MP-16).
		return buildBoxLabels(
			{ ...donation, items: withCurrentLinePoints(donation.items, shelter) },
			lineDestinationResolver(shelter, t.anyPointGroupTitle)
		);
	});

	// Every sheet of one booking carries the same booking ref, so one image serves them all.
	const qrValue = $derived(labels[0]?.qrValue ?? '');
	let qrSrc = $state('');
	$effect(() => {
		const value = qrValue;
		if (!value) {
			qrSrc = '';
			return;
		}
		let cancelled = false;
		// Whole pixels per module keep the printed squares even.
		qrModuleCount(value)
			.then((modules) => generateQrDataUrl(value, { margin: 2, width: (modules + 4) * 10 }))
			.then((url) => {
				if (!cancelled) qrSrc = url;
			})
			.catch(() => {
				if (!cancelled) qrSrc = '';
			});
		return () => {
			cancelled = true;
		};
	});

	// The print copy must be a direct child of <body> so print CSS can drop the whole page
	// (navbar, footer, preview) with display:none; visibility:hidden keeps its height and
	// pushes the label onto a second page.
	function mountOnBody(node: HTMLElement) {
		document.body.appendChild(node);
		return () => node.remove();
	}
</script>

<svelte:head>
	<title>{t.boxLabelPageTitle}</title>
	<!-- Static CSS built from BOX_LABEL_MM constants only (no user input). -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html `<style>${boxLabelPageCss()}</style>`}
</svelte:head>

<PublicPageShell maxWidth="max-w-3xl">
	<a
		href={resolve(`/donations/track/${encodeURIComponent(token)}`)}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		{t.boxLabelBackToTrack}
	</a>

	{#if trackingQuery.isPending}
		<div
			class="flex items-center justify-center gap-3 rounded-3xl border border-border bg-card p-12 text-sm text-muted-foreground"
		>
			<LoaderCircle class="h-5 w-5 animate-spin" />
			{t.loadingStatus}
		</div>
	{:else if trackingQuery.isError}
		<div class="rounded-3xl border border-danger-border bg-card p-8 text-center shadow-sm">
			<div
				class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger"
			>
				<AlertCircle class="h-6 w-6" />
			</div>
			<h2 class="text-base font-bold text-foreground">{t.notFoundTitle}</h2>
			<p class="mt-2 text-xs text-muted-foreground">
				{trackingQuery.error instanceof Error ? trackingQuery.error.message : t.loadingStatus}
			</p>
		</div>
	{:else if !printable}
		<div
			class="rounded-3xl border border-border bg-card p-8 text-center shadow-sm"
			data-testid="box-label-not-ready"
		>
			<div
				class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning"
			>
				<Printer class="h-6 w-6" />
			</div>
			<h2 class="text-base font-bold text-foreground">{t.boxLabelNotReadyTitle}</h2>
			<p class="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">{t.boxLabelNotReadyBody}</p>
			<a
				href={resolve(`/donations/track/${encodeURIComponent(token)}`)}
				class="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"
			>
				{t.boxLabelBackToTrack}
			</a>
		</div>
	{:else if shelterPending}
		<div
			class="flex items-center justify-center gap-3 rounded-3xl border border-border bg-card p-12 text-sm text-muted-foreground"
		>
			<LoaderCircle class="h-5 w-5 animate-spin" />
			{t.loadingStatus}
		</div>
	{:else if labels.length === 0}
		<div
			class="rounded-3xl border border-border bg-card p-8 text-center text-sm text-muted-foreground"
		>
			{t.boxLabelNoLines}
		</div>
	{:else}
		<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h1 class="text-lg font-extrabold text-foreground">{t.boxLabelHeading}</h1>
				<p class="mt-1 max-w-md text-xs text-muted-foreground">{t.boxLabelPrintTip}</p>
			</div>
			<Button
				type="button"
				onclick={() => window.print()}
				class="h-10 shrink-0 rounded-xl px-4 text-xs font-bold"
				data-testid="box-label-print-btn"
			>
				<Printer class="h-4 w-4" />
				{t.boxLabelPrintBtn}
			</Button>
		</div>

		<div
			class="flex flex-col items-center gap-6 rounded-3xl border border-border bg-muted/50 p-4 sm:p-8"
			data-testid="box-label-preview"
		>
			{#each labels as label (label.sheet.index)}
				<div class="max-w-full overflow-x-auto shadow-md">
					<BoxLabelSheet {label} {qrSrc} {units} />
				</div>
			{/each}
		</div>

		<div hidden>
			<div class="box-label-print" aria-hidden="true" {@attach mountOnBody}>
				{#each labels as label (label.sheet.index)}
					<BoxLabelSheet {label} {qrSrc} {units} />
				{/each}
			</div>
		</div>
	{/if}
</PublicPageShell>

<style>
	.box-label-print {
		display: none;
	}

	@media print {
		:global(body) {
			margin: 0 !important;
		}
		:global(body > :not(.box-label-print)) {
			display: none !important;
		}
		.box-label-print {
			display: block;
		}
	}
</style>

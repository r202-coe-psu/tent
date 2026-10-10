<script lang="ts">
	import { cn } from '$lib/utils/shadcn';

	type Props = {
		/** QR data URL; empty renders the placeholder. */
		src: string | null | undefined;
		alt: string;
		name: string;
		phone?: string | null;
		/** Station boxes ticked by hand (e.g. เช็คอิน · คัดกรอง · ที่พัก). */
		checklist: readonly string[];
		/**
		 * 'screen' = staff ID card (responsive; `print-capture` class switches it to the fixed PDF
		 * card); 'label' = 80×60 mm thermal label sized by the `--qr-size` / `--label-gap` CSS vars.
		 */
		variant?: 'screen' | 'label';
		id?: string;
		ref?: HTMLDivElement | null;
		class?: string;
	};

	let {
		src,
		alt,
		name,
		phone,
		checklist,
		variant = 'screen',
		id,
		ref = $bindable(null),
		class: className
	}: Props = $props();

	/*
		Label sizes mirror KIOSK_LABEL_TEXT / KIOSK_LABEL_CHECKBOX in
		features/kiosk/domain/print-label.ts, which the kiosk canvas renderer draws from.
	*/
	const VARIANTS = {
		screen: {
			root: 'qr-identity-card mx-auto flex w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md sm:min-h-44 sm:flex-row dark:border-slate-700',
			panel:
				'card-qr-panel order-1 flex w-full shrink-0 items-center justify-center border-b border-slate-200 bg-slate-50 px-5 py-5 sm:order-2 sm:w-auto sm:border-b-0 sm:border-l sm:px-5 dark:border-slate-700 dark:bg-slate-900/30',
			qr: 'card-qr-image size-36 object-contain sm:size-36 md:size-40',
			placeholder:
				'flex size-36 items-center justify-center rounded bg-slate-100 text-2xs text-slate-400 sm:size-36 md:size-40',
			details:
				'card-details order-2 flex min-w-0 flex-1 flex-col justify-start gap-0.5 px-4 py-5 sm:order-1 sm:min-h-44 sm:px-5',
			name: 'card-name text-base leading-tight font-bold text-slate-900 sm:text-xl',
			phone: 'card-phone font-mono text-2xs font-bold tracking-widest text-slate-900 sm:text-xs',
			checklist:
				'card-checklist mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-2xs font-medium text-slate-900 sm:text-xs',
			item: 'inline-flex items-center gap-1.5',
			box: 'card-check-box size-3.5 shrink-0 border border-slate-900 sm:size-4'
		},
		label: {
			root: 'flex h-full w-full flex-row text-black',
			panel:
				'order-2 ml-(--label-gap) flex shrink-0 items-center border-l-[0.25mm] border-black pl-(--label-gap)',
			qr: 'block size-(--qr-size) [image-rendering:pixelated]',
			placeholder: 'grid size-(--qr-size) place-items-center border border-black text-[8pt]',
			details: 'order-1 flex min-w-0 flex-1 flex-col gap-[0.5mm]',
			name: 'line-clamp-3 text-[16pt] leading-[1.3] font-bold [overflow-wrap:anywhere]',
			phone: 'font-mono text-[12pt] leading-[1.3] font-bold tracking-[0.1em]',
			checklist:
				'mt-auto flex flex-wrap items-center gap-x-[4mm] gap-y-[1.5mm] text-[10pt] leading-[1.3] font-medium',
			item: 'inline-flex items-center gap-[1.5mm]',
			box: 'size-[3.5mm] shrink-0 border-[0.3mm] border-black'
		}
	} as const;

	const styles = $derived(VARIANTS[variant]);
</script>

<div bind:this={ref} {id} class={cn(styles.root, className)}>
	<div class={styles.panel}>
		{#if src}
			<img {src} {alt} class={styles.qr} />
		{:else}
			<div class={styles.placeholder}>{variant === 'label' ? 'QR' : '...'}</div>
		{/if}
	</div>

	<div class={styles.details}>
		<p class={styles.name}>{name}</p>
		{#if phone}
			<span class={styles.phone}>{phone}</span>
		{/if}
		<div class={styles.checklist}>
			{#each checklist as item (item)}
				<span class={styles.item}>
					<span class={styles.box} aria-hidden="true"></span>
					{item}
				</span>
			{/each}
		</div>
	</div>
</div>

<style>
	/* The PDF capture uses this fixed desktop card independently of the app viewport. */
	:global(.qr-identity-card.print-capture) {
		width: 760px !important;
		max-width: none !important;
		min-height: 210px !important;
		flex-direction: row !important;
	}

	:global(.qr-identity-card.print-capture .card-qr-panel) {
		order: 2 !important;
		width: auto !important;
		border-top: 0 !important;
		border-left: 1px solid #e2e8f0 !important;
		padding: 20px 28px !important;
	}

	:global(.qr-identity-card.print-capture .card-details) {
		order: 1 !important;
		justify-content: flex-start !important;
		padding: 24px 28px !important;
	}

	:global(.qr-identity-card.print-capture .card-qr-image) {
		height: 160px !important;
		width: 160px !important;
	}

	:global(.qr-identity-card.print-capture .card-phone) {
		font-size: 1rem !important;
		color: #0f172a !important;
	}

	:global(.qr-identity-card.print-capture .card-name) {
		font-size: 1.875rem !important;
	}

	:global(.qr-identity-card.print-capture .card-checklist) {
		font-size: 0.875rem !important;
		gap: 1rem !important;
		padding-top: 1.25rem !important;
	}

	:global(.qr-identity-card.print-capture .card-check-box) {
		height: 16px !important;
		width: 16px !important;
		border-color: #0f172a !important;
	}
</style>

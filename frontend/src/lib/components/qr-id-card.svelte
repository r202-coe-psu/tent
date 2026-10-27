<script lang="ts">
	import { cn } from '$lib/utils/shadcn';

	type Props = {
		/** QR data URL; empty renders the placeholder. */
		src: string | null | undefined;
		alt: string;
		name: string;
		/**
		 * Zone row under the name: `value` is the assigned zone's name, or null for a blank dotted
		 * line staff fill in by hand. Omit for no zone row.
		 */
		zone?: { label: string; value: string | null };
		/** Small line at the bottom of the text column, e.g. the site address. */
		footer?: string;
		/** Station boxes (e.g. เช็คอิน · คัดกรอง · ที่พัก), one per row. */
		checklist: readonly string[];
		/** Stations already passed: this many boxes are ticked, top first. */
		checkedCount?: number;
		class?: string;
	};

	let {
		src,
		alt,
		name,
		zone,
		footer,
		checklist,
		checkedCount = 0,
		class: className
	}: Props = $props();

	/*
		80×60 mm thermal label sized by the `--qr-size` / `--label-gap` CSS vars. Sizes mirror
		KIOSK_LABEL_TEXT / KIOSK_LABEL_CHECKBOX in features/kiosk/domain/print-label.ts, which the
		kiosk canvas renderer draws from.
	*/
</script>

<div class={cn('flex h-full w-full flex-row text-black', className)}>
	<div class="flex min-w-0 flex-1 flex-col gap-[1mm]">
		<p class="line-clamp-3 text-[16pt] leading-[1.3] font-bold [overflow-wrap:anywhere]">{name}</p>
		{#if zone}
			<p class="flex items-baseline gap-[1.5mm] text-[12pt] leading-[1.3] font-bold">
				<span class="shrink-0">{zone.label}</span>
				{#if zone.value}
					<span class="min-w-0 truncate">{zone.value}</span>
				{:else}
					<span class="min-w-0 flex-1 border-b-[0.375mm] border-dotted border-black"></span>
				{/if}
			</p>
		{/if}
		<div
			class="label-checklist mt-auto flex flex-col items-start gap-[1.5mm] text-[10pt] leading-[1.3] font-medium"
		>
			{#each checklist as item, index (item)}
				<span class="inline-flex items-center gap-[1.5mm]">
					<span class="size-[3.5mm] shrink-0 border-[0.3mm] border-black" aria-hidden="true">
						{#if index < checkedCount}
							<svg viewBox="0 0 10 10" class="block size-full">
								<polyline
									points="2,5.2 4.2,7.5 8,2.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.4"
									stroke-linecap="square"
								/>
							</svg>
						{/if}
					</span>
					{item}
				</span>
			{/each}
		</div>
		{#if footer}
			<span class="text-[7pt] leading-[1.3] font-medium whitespace-nowrap">{footer}</span>
		{/if}
	</div>

	<div
		class="ml-(--label-gap) flex shrink-0 items-center border-l-[0.25mm] border-black pl-(--label-gap)"
	>
		{#if src}
			<img {src} {alt} class="block size-(--qr-size) [image-rendering:pixelated]" />
		{:else}
			<div class="grid size-(--qr-size) place-items-center border border-black text-[8pt]">QR</div>
		{/if}
	</div>
</div>

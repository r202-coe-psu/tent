<script lang="ts">
	import { cn } from '$lib/utils/shadcn';

	type Props = {
		/** QR data URL, or the pending promise of one. Empty renders the placeholder. */
		src: string | Promise<string> | null | undefined;
		alt: string;
		caption: string;
		name: string;
		detail?: string;
		/** Shown in place of the QR when `src` rejects. */
		fallback?: string;
		/** 'screen' = phone ticket / PDF; 'label' = thermal label sized by the `--qr-size` CSS var. */
		variant?: 'screen' | 'label';
		class?: string;
	};

	let {
		src,
		alt,
		caption,
		name,
		detail,
		fallback,
		variant = 'screen',
		class: className
	}: Props = $props();

	const VARIANTS = {
		screen: {
			root: 'flex flex-col items-center gap-3',
			qr: 'h-44 w-44',
			placeholder: 'h-44 w-44 animate-pulse rounded-lg bg-muted',
			fallback:
				'flex h-44 w-44 items-center justify-center rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground',
			text: 'text-center',
			// eslint-disable-next-line no-restricted-syntax -- Keep the existing ticket caption size unchanged.
			caption: 'text-[11px] font-semibold tracking-wider text-muted-foreground uppercase',
			name: 'text-base font-bold text-foreground',
			detail: 'mt-1 font-mono text-xs text-muted-foreground'
		},
		label: {
			root: 'flex w-full flex-col items-center text-center text-black',
			qr: 'block size-(--qr-size) [image-rendering:pixelated]',
			placeholder: 'grid size-(--qr-size) place-items-center border border-black text-[8pt]',
			fallback: 'grid size-(--qr-size) place-items-center border border-black text-[8pt]',
			text: 'flex w-full min-w-0 flex-col gap-[0.6mm]',
			caption: 'text-[8pt] leading-[1.2]',
			name: 'line-clamp-2 text-[12pt] leading-[1.3] font-extrabold [overflow-wrap:anywhere]',
			detail: 'text-[8pt] leading-[1.2]'
		}
	} as const;

	const styles = $derived(VARIANTS[variant]);
</script>

{#snippet placeholder()}
	<div class={styles.placeholder}>{variant === 'label' ? 'QR' : ''}</div>
{/snippet}

<div class={cn(styles.root, className)}>
	{#await src}
		{@render placeholder()}
	{:then url}
		{#if url}<img src={url} {alt} class={styles.qr} />{:else}{@render placeholder()}{/if}
	{:catch}
		{#if fallback && variant === 'screen'}<p class={styles.fallback}>
				{fallback}
			</p>{:else}{@render placeholder()}{/if}
	{/await}
	<div class={styles.text}>
		<p class={styles.caption}>{caption}</p>
		<p class={styles.name}>{name}</p>
		{#if detail}<p class={styles.detail}>{detail}</p>{/if}
	</div>
</div>

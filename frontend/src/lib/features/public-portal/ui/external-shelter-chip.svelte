<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';

	/**
	 * CR-252 FR-20 / FR-23: status chip of a shelter run in another system — gray (Slate/Neutral),
	 * text label + external-link icon (never color alone). A vetted `https://` link makes it an
	 * anchor that opens the source system in a new tab.
	 */
	interface Props {
		label: string;
		/** Already vetted by `safeExternalUrl`; `null` renders a plain, non-link chip. */
		href?: string | null;
		/** Accessible name of the link, e.g. "ไปยังระบบต้นทาง (เปิดในแท็บใหม่)". */
		linkLabel?: string;
		class?: string;
	}

	let { label, href = null, linkLabel, class: className = '' }: Props = $props();

	const chipClass =
		'inline-flex min-h-6 items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700';
</script>

{#if href}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		aria-label={linkLabel ?? label}
		data-testid="external-shelter-chip"
		class="{chipClass} hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {className}"
	>
		<span>{label}</span>
		<ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
	</a>
{:else}
	<span data-testid="external-shelter-chip" class="{chipClass} {className}">
		<span>{label}</span>
		<ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
	</span>
{/if}

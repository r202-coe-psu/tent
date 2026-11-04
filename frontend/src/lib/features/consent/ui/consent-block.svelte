<script lang="ts" module>
	/** Group A (pre-register only, FR-22): a required acknowledgement the host owns. */
	export interface ConsentAcknowledgement {
		checked: boolean;
		onchange: (value: boolean) => void;
		text: string;
		/** Shown under the A row while it is unticked. */
		needMessage: string;
		/** Conditions listed above the A row (the shelter's rules). */
		conditions?: {
			title: string;
			groups: readonly { label: string; items: readonly string[] }[];
		};
	}
</script>

<script lang="ts">
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { ConsentBlockState } from '../application/consent-block.svelte';
	import type { ConsentDecision } from '../domain/consent';
	import { CONSENT_COPY as copy } from '../domain/consent-notice.i18n';

	let {
		block,
		hasMedicalInput = false,
		disabled = false,
		confirm = 'embedded',
		size = 'default',
		showLinks = true,
		acknowledgement,
		needId,
		onconfirm
	}: {
		block: ConsentBlockState;
		hasMedicalInput?: boolean;
		disabled?: boolean;
		/** 'embedded': the host form's submit is the confirm (FR-19). 'standalone': the block renders it. */
		confirm?: 'embedded' | 'standalone';
		/** 'kiosk': touch-sized controls and text; the kiosk-portrait/kiosk-compact variants only apply here. */
		size?: 'default' | 'kiosk';
		/** FR-23: /term and /policy links in the intro. Off on kiosk. */
		showLinks?: boolean;
		acknowledgement?: ConsentAcknowledgement;
		/** Id of the "what is missing" message, so an embedded host submit can point `aria-describedby` at it (FR-11). */
		needId?: string;
		/** Standalone: called with the decision once confirmed. */
		onconfirm?: (decision: ConsentDecision) => void;
	} = $props();

	const uid = $props.id();
	const needMessageId = $derived(needId ?? `${uid}-need`);

	const sizes = {
		default: {
			section: 'space-y-4 p-4 sm:p-6',
			heading: 'text-lg sm:text-xl',
			groupHeading: 'text-sm sm:text-base',
			option: 'min-h-12',
			optionText: 'text-sm sm:text-base',
			fullText: 'text-xs sm:text-sm',
			checkbox: 'size-5',
			nested: 'ms-8',
			button: 'min-h-12'
		},
		kiosk: {
			section:
				'space-y-4 p-4 kiosk-portrait:space-y-5 kiosk-portrait:p-8 kiosk-compact:space-y-2 kiosk-compact:p-3',
			heading: 'text-xl kiosk-portrait:text-3xl kiosk-compact:text-lg',
			groupHeading: 'text-base kiosk-portrait:text-xl kiosk-compact:text-sm',
			option: 'min-h-14 kiosk-portrait:min-h-20 kiosk-compact:min-h-11',
			optionText: 'text-base kiosk-portrait:text-2xl kiosk-compact:text-sm',
			fullText: 'text-sm kiosk-portrait:text-lg kiosk-compact:text-xs',
			checkbox: 'size-6 kiosk-portrait:size-9 kiosk-compact:size-5',
			nested: 'ms-8 kiosk-portrait:ms-12',
			button:
				'h-auto min-h-14 w-full whitespace-normal py-3 text-lg kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-12 kiosk-compact:text-base'
		}
	} as const;
	const sz = $derived(sizes[size]);

	let expanded = $state<string[]>([]);
	function toggleFull(key: string) {
		expanded = expanded.includes(key) ? expanded.filter((k) => k !== key) : [...expanded, key];
	}

	const ackMissing = $derived(acknowledgement !== undefined && !acknowledgement.checked);
	const needMessages = $derived([
		...(ackMissing && acknowledgement ? [acknowledgement.needMessage] : []),
		...(block.canConfirm ? [] : [copy.needMain])
	]);

	function acceptAll() {
		block.acceptAll();
		acknowledgement?.onchange(true);
	}

	function confirmStandalone() {
		const gate = block.confirm();
		if (gate.kind === 'decided') onconfirm?.(gate.decision);
	}
</script>

{#snippet option(
	key: string,
	checked: boolean,
	onchange: (value: boolean) => void,
	text: string,
	opts: { full?: string; locked?: boolean; nested?: boolean } = {}
)}
	{@const id = `${uid}-${key}`}
	{@const isOpen = expanded.includes(key)}
	<div class={['space-y-1', opts.nested && sz.nested]}>
		<label
			for={id}
			class={[
				'flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors has-[[data-state=checked]]:border-domain-registration-border has-[[data-state=checked]]:bg-domain-registration-subtle/40',
				opts.locked
					? 'cursor-not-allowed opacity-60'
					: 'cursor-pointer hover:border-domain-registration-border',
				sz.option
			]}
		>
			<Checkbox
				{id}
				{checked}
				disabled={disabled || opts.locked}
				onCheckedChange={(value) => onchange(value === true)}
				class={[
					'mt-0.5 shrink-0 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
					sz.checkbox
				]}
			/>
			<span class={['leading-relaxed text-slate-800', sz.optionText]}>
				{text}
			</span>
		</label>
		{#if opts.full}
			<div class="ps-11">
				<button
					type="button"
					class="min-h-8 text-sm font-semibold text-domain-registration-text underline underline-offset-2 hover:text-domain-registration-strong focus-visible:rounded focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					aria-expanded={isOpen}
					aria-controls="{id}-full"
					onclick={() => toggleFull(key)}
				>
					{isOpen ? copy.hideFull : copy.showFull}
				</button>
				{#if isOpen}
					<p id="{id}-full" class={['mt-1 leading-relaxed text-slate-600', sz.fullText]}>
						{opts.full}
					</p>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<section
	aria-labelledby="{uid}-heading"
	class={['rounded-2xl border border-slate-200/80 bg-white shadow-2xs', sz.section]}
>
	<div class="space-y-1.5">
		<h3 id="{uid}-heading" class={['flex items-center gap-2 font-bold text-slate-900', sz.heading]}>
			<ShieldCheck class="size-5 text-domain-registration" aria-hidden="true" />
			{copy.heading}
		</h3>
		<p class={['leading-relaxed text-slate-600', sz.fullText]}>
			{#if showLinks}
				{copy.intro.before}<a
					href={resolve('/term')}
					target="_blank"
					rel="noopener noreferrer"
					class="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
					>{copy.intro.term}<ExternalLink
						class="ms-0.5 inline size-3.5 align-[-0.125em]"
						aria-hidden="true"
					/></a
				>{copy.intro.and}<a
					href={resolve('/policy')}
					target="_blank"
					rel="noopener noreferrer"
					class="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
					>{copy.intro.policy}<ExternalLink
						class="ms-0.5 inline size-3.5 align-[-0.125em]"
						aria-hidden="true"
					/></a
				>{copy.intro.after}
			{:else}
				{copy.intro.kiosk}
			{/if}
		</p>
	</div>

	<Button
		type="button"
		variant="outline"
		class={[
			'w-full gap-2 border-domain-registration-border font-semibold text-domain-registration-text hover:bg-domain-registration-subtle',
			sz.button
		]}
		{disabled}
		onclick={acceptAll}
	>
		<CheckCheck class="size-5" aria-hidden="true" />
		{copy.acceptAll}
	</Button>

	{#if acknowledgement}
		<div class="space-y-2">
			<h4 class={['font-semibold text-slate-900', sz.groupHeading]}>
				{copy.acknowledgementHeading}
			</h4>
			{#if acknowledgement.conditions}
				<div class="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
					<p class="text-sm font-bold text-amber-950">{acknowledgement.conditions.title}</p>
					{#each acknowledgement.conditions.groups as group (group.label)}
						<div>
							<p class="mb-1 text-xs font-semibold text-amber-950">{group.label}</p>
							<ul class="list-disc space-y-0.5 ps-5 text-xs text-amber-900">
								{#each group.items as item (item)}
									<li>{item}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}
			{@render option(
				'ack',
				acknowledgement.checked,
				acknowledgement.onchange,
				acknowledgement.text
			)}
		</div>
	{/if}

	<div class="space-y-2">
		<h4 class={['font-semibold text-slate-900', sz.groupHeading]}>{copy.consentHeading}</h4>
		{@render option('main', block.full, (value) => (block.full = value), copy.main.short, {
			full: copy.main.full
		})}
		{@render option('health', block.health, (value) => (block.health = value), copy.health.short, {
			full: copy.health.full,
			locked: !block.full,
			nested: true
		})}
		{@render option(
			'search',
			block.searchVisible,
			(value) => (block.searchVisible = value),
			copy.search.short,
			{ full: copy.search.full, locked: !block.full, nested: true }
		)}

		{#if block.showsVerbal && block.staff}
			<div class="space-y-2 rounded-xl border border-dashed border-slate-300 p-2">
				{@render option(
					'verbal',
					block.verbal,
					(value) => (block.verbal = value),
					copy.verbal.text
				)}
				{#if block.verbal}
					<p class="ms-8 text-sm text-slate-700">
						<span class="font-semibold">{copy.verbal.staffLabel}:</span>
						{block.staff.name} <span class="tabular-nums">({block.staff.userId})</span>
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if block.discardsMedical(hasMedicalInput)}
		<p
			class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{copy.healthDiscardWarning}
		</p>
	{/if}

	{#if needMessages.length > 0}
		<div id={needMessageId} class="space-y-1 text-sm font-semibold text-red-700" aria-live="polite">
			{#each needMessages as message (message)}
				<p>{message}</p>
			{/each}
		</div>
	{/if}

	{#if confirm === 'standalone'}
		<Button
			class={[
				'bg-domain-registration-strong text-white hover:bg-domain-registration-text',
				sz.button
			]}
			disabled={disabled || !block.canConfirm}
			aria-describedby={block.canConfirm ? undefined : needMessageId}
			onclick={confirmStandalone}
		>
			{copy.actions.confirm}
		</Button>
	{/if}
</section>

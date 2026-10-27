<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';
	import { formatReferralNameSummary } from './referral.ui-helpers';

	let {
		open = $bindable(false),
		title,
		description,
		names,
		count,
		confirmLabel,
		destructive = false,
		pending = false,
		portalDisabled = false,
		children,
		onConfirm
	}: {
		/** Owned by the caller. The dialog sets it to `false` after `onConfirm` settles or on cancel. */
		open?: boolean;
		title: string;
		/** Optional extra line, e.g. how many items a typed response reason will apply to. */
		description?: string;
		/** Evacuee names shown as "ชื่อไม่เกิน 5 คน + และอีก N คน". */
		names: string[];
		count: number;
		confirmLabel: string;
		destructive?: boolean;
		/** Caller-side busy flag. Keeps the confirm button disabled while work is in flight. */
		pending?: boolean;
		/** Renders inline instead of through the portal. Only for SSR markup tests; production keeps the portal. */
		portalDisabled?: boolean;
		/** Extra body between the summary and the buttons, e.g. an optional reason field. */
		children?: Snippet;
		onConfirm: () => unknown;
	} = $props();

	let busy = $state(false);
	const locked = $derived(busy || pending);
	const namesLine = $derived(formatReferralNameSummary(names));

	async function confirm() {
		// Synchronous guard against a second click before the disabled state reaches the DOM.
		if (busy || pending) return;
		busy = true;
		try {
			await onConfirm();
		} finally {
			busy = false;
			open = false;
		}
	}
</script>

<AlertDialog.Root
	bind:open={
		() => open,
		(value) => {
			// Escape and outside clicks must not close the dialog while work is in flight.
			if (!locked) open = value;
		}
	}
>
	<AlertDialog.Content class="gap-4" portalProps={{ disabled: portalDisabled }}>
		<AlertDialog.Header class="gap-2">
			<AlertDialog.Title class="text-base font-bold text-slate-900">{title}</AlertDialog.Title>
			<AlertDialog.Description class="space-y-1 text-sm text-slate-700">
				<span class="block"
					>จำนวน <span class="font-semibold tabular-nums">{count}</span> รายการ</span
				>
				{#if namesLine}
					<span class="block">ผู้เข้าพัก: {namesLine}</span>
				{/if}
				{#if description}
					<span class="block">{description}</span>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{@render children?.()}
		<AlertDialog.Footer class="gap-2">
			<Button
				variant="outline"
				class="min-h-11 w-full sm:w-auto"
				disabled={locked}
				onclick={() => (open = false)}
			>
				ยกเลิก
			</Button>
			<Button
				variant={destructive ? 'destructive' : 'default'}
				class="min-h-11 w-full sm:w-auto"
				disabled={locked}
				onclick={confirm}
			>
				{confirmLabel}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

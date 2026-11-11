<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import type { KioskHouseholdCandidate } from '../data/kiosk-check-in.api';
	import { KIOSK_QR_FLOW_I18N } from './_constants/kiosk-qr-flow.i18n';

	interface Props {
		candidates: KioskHouseholdCandidate[];
		onselect: (primaryEvacueeId: string) => void;
		disabled?: boolean;
		/** `reprint` counts members whose QR can be printed instead of those waiting to report. */
		mode?: 'check-in' | 'reprint';
	}

	let { candidates, onselect, disabled = false, mode = 'check-in' }: Props = $props();

	const t = $derived(getTranslation(KIOSK_QR_FLOW_I18N, languageStore.current).picker);

	function summary(candidate: KioskHouseholdCandidate): string {
		if (mode === 'reprint') {
			return candidate.pending_count === 0
				? t.reprintNone(candidate.member_count)
				: t.reprintSome(candidate.member_count, candidate.pending_count);
		}
		return candidate.pending_count === 0
			? t.allReported
			: t.pendingSummary(candidate.member_count, candidate.pending_count);
	}

	function accessibleName(candidate: KioskHouseholdCandidate): string {
		const state =
			mode === 'reprint'
				? t.reprintState(candidate.pending_count)
				: t.pendingState(candidate.pending_count);
		return t.accessibleName(candidate.contact_display, candidate.member_count, state);
	}
</script>

<section class="space-y-3 kiosk-portrait:space-y-5" aria-labelledby="phone-household-title">
	<header>
		<h2
			id="phone-household-title"
			class="text-lg font-bold tracking-tight text-slate-900 sm:text-xl kiosk-portrait:text-3xl"
		>
			{t.heading}
		</h2>
		<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
			{t.subheading}
		</p>
	</header>
	<div class="space-y-2 kiosk-portrait:space-y-4">
		{#each candidates as candidate (candidate.primary_evacuee_id)}
			<Button
				type="button"
				variant="outline"
				{disabled}
				onclick={() => onselect(candidate.primary_evacuee_id)}
				aria-label={accessibleName(candidate)}
				class="h-auto min-h-20 w-full justify-start gap-4 rounded-xl border-slate-200 bg-white px-4 py-3 text-left text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 kiosk-compact:min-h-16"
			>
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647] kiosk-portrait:h-14 kiosk-portrait:w-14"
					aria-hidden="true"
				>
					<UsersRound class="size-5 kiosk-portrait:size-7" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-lg font-bold sm:text-xl kiosk-portrait:text-3xl"
						>{candidate.contact_display || t.noName}</span
					>
					<span
						class="mt-1 block text-base font-medium text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:text-sm"
					>
						{summary(candidate)}
					</span>
				</span>
			</Button>
		{/each}
	</div>
</section>

<script lang="ts">
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { KioskEvacueeSummary } from '../data/kiosk-check-in.api';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_REPRINT_I18N } from './_constants/kiosk-reprint.i18n';
	import { KIOSK_NOTICE_SECONDARY_ACTION } from './kiosk-notice-actions';

	interface Props {
		members: readonly KioskEvacueeSummary[];
		selectedIds: readonly string[];
		allSelected: boolean;
		disabled?: boolean;
		ontoggle: (evacueeId: string) => void;
		ontoggleall: () => void;
	}

	let {
		members,
		selectedIds,
		allSelected,
		disabled = false,
		ontoggle,
		ontoggleall
	}: Props = $props();

	const t = $derived(getTranslation(KIOSK_REPRINT_I18N, languageStore.current).memberList);
	const selectableCount = $derived(members.filter((member) => member.selectable).length);

	function fullName(member: Pick<KioskEvacueeSummary, 'first_name' | 'last_name'>): string {
		return [member.first_name, member.last_name].filter(Boolean).join(' ') || t.noName;
	}

	function statusLabel(member: Pick<KioskEvacueeSummary, 'status' | 'selectable'>): string {
		const { status } = member;
		if (!member.selectable) {
			if (status === 'pre_registered') return t.preRegisteredReason;
			if (status === 'temporary_leave') return t.temporaryLeaveReason;
		}
		if (status === 'arriving') return t.arriving;
		if (status === 'room_confirmed') return t.room_confirmed;
		if (status === 'active') return t.active;
		return t.preRegisteredReason;
	}
</script>

<section
	class="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-6 kiosk-compact:p-3"
	aria-labelledby="reprint-members-title"
>
	<div class="mb-3 flex items-center gap-3 kiosk-portrait:mb-6 kiosk-portrait:gap-5">
		<div
			class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647] kiosk-portrait:h-20 kiosk-portrait:w-20 kiosk-compact:h-11 kiosk-compact:w-11"
			aria-hidden="true"
		>
			<UsersRound class="size-6 kiosk-portrait:size-10" />
		</div>
		<div class="min-w-0 flex-1">
			<h2
				id="reprint-members-title"
				class="text-lg font-bold text-slate-900 sm:text-xl kiosk-portrait:text-3xl"
			>
				{t.heading}
			</h2>
			<p class="text-base text-slate-600 kiosk-portrait:text-xl kiosk-compact:text-sm">
				{t.nameMasked}
			</p>
		</div>
		{#if selectableCount > 1}
			<Button
				type="button"
				variant="outline"
				{disabled}
				onclick={ontoggleall}
				class="{KIOSK_NOTICE_SECONDARY_ACTION} w-auto shrink-0 kiosk-portrait:px-10"
			>
				{allSelected ? t.clearAll : t.selectAll}
			</Button>
		{/if}
	</div>

	<div class="space-y-3 kiosk-portrait:space-y-4 kiosk-compact:space-y-2">
		{#each members as member (member.evacuee_id)}
			{@const selected = selectedIds.includes(member.evacuee_id)}
			<!-- The whole row is the tap target: the label forwards taps to the checkbox. -->
			<label
				class={[
					'flex min-h-20 items-center gap-4 rounded-xl border-2 px-4 py-3 kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 kiosk-compact:min-h-14 kiosk-compact:py-1',
					!member.selectable && 'border-slate-200 bg-slate-50 opacity-75',
					member.selectable &&
						(selected
							? 'border-[#0A2647] bg-sky-50'
							: 'border-slate-200 bg-white active:bg-slate-50'),
					member.selectable && !disabled && 'cursor-pointer',
					member.selectable && disabled && 'cursor-not-allowed'
				]}
			>
				{#if member.selectable}
					<Checkbox
						checked={selected}
						onCheckedChange={() => ontoggle(member.evacuee_id)}
						{disabled}
						aria-labelledby={`reprint-member-${member.evacuee_id}`}
						class="size-12 shrink-0 kiosk-compact:size-10"
					/>
				{:else}
					<span class="size-12 shrink-0 kiosk-compact:size-10" aria-hidden="true"></span>
				{/if}
				<div class="min-w-0 flex-1">
					<p
						id={`reprint-member-${member.evacuee_id}`}
						class="truncate text-lg font-bold text-slate-950 sm:text-xl kiosk-portrait:text-2xl kiosk-compact:text-lg"
					>
						{fullName(member)}
					</p>
					<p
						class="mt-1 text-base text-slate-600 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:mt-0 kiosk-compact:text-sm"
					>
						{#if member.selectable}
							{member.age === null ? t.ageUnknown : t.age(member.age)}
							<span class="mx-1" aria-hidden="true">·</span>
						{/if}{statusLabel(member)}
					</p>
				</div>
			</label>
		{/each}
	</div>
</section>

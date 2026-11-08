<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Evacuee } from '$lib/features/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';

	let {
		evacuee,
		readonly,
		onOpenEdit
	}: { evacuee: Evacuee; readonly: boolean; onOpenEdit: () => void } = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).emergencyCard);
</script>

<section
	class="space-y-4 rounded-lg border border-amber-200/70 bg-amber-50/40 p-5 dark:border-amber-900/40 dark:bg-amber-950/10"
>
	<div
		class="flex items-center justify-between border-b border-amber-200/50 pb-2 dark:border-amber-900/20"
	>
		<div class="flex items-center gap-2.5">
			<ShieldAlert class="size-4.5 text-amber-600 dark:text-amber-500" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">{t.title}</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label={t.editAria}
				title={t.editAria}
				onclick={onOpenEdit}
				class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-amber-100 hover:text-foreground dark:hover:bg-amber-950"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>
	<div class="min-w-0 space-y-3.5">
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.contactName}</span>
			<span class="mt-0.5 block text-sm font-bold break-words text-slate-800 dark:text-slate-200">
				{evacuee.emergency_contact?.name || t.noContactName}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.contactPhone}</span>
			<span
				class="mt-0.5 block text-sm font-bold break-words {evacuee.emergency_contact?.phone
					? 'text-slate-800 dark:text-slate-200'
					: 'font-semibold text-red-500 dark:text-red-400'}"
			>
				{evacuee.emergency_contact?.phone || t.noPhone}
			</span>
		</div>
		{#if evacuee.emergency_contact?.relation}
			<div class="min-w-0">
				<span class="block text-xs font-medium text-muted-foreground">{t.relation}</span>
				<span class="mt-0.5 block text-sm font-bold break-words text-slate-800 dark:text-slate-200">
					{evacuee.emergency_contact.relation}
				</span>
			</div>
		{/if}
	</div>
</section>

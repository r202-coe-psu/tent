<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Pencil from '@lucide/svelte/icons/pencil';
	import {
		evacueeAgeYears,
		formatPersonName,
		genderLabel,
		maskNationalId,
		type Evacuee
	} from '$lib/features/people';
	import { getCountryName } from '$lib/utils/country';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';

	let {
		evacuee,
		readonly,
		onOpenEdit
	}: { evacuee: Evacuee; readonly: boolean; onOpenEdit: () => void } = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).personalCard);

	const ageYears = $derived(evacueeAgeYears(evacuee));
</script>

<section class="space-y-4 rounded-lg border border-border bg-card p-5">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<User class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">{t.title}</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label={t.editAria}
				title={t.editAria}
				onclick={onOpenEdit}
				class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>
	<div class="grid min-w-0 grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
		<div class="min-w-0 border-b border-border/50 pb-3 sm:col-span-2">
			<span class="block text-xs font-medium text-muted-foreground">{t.fullName}</span>
			<span
				class="mt-0.5 block text-sm font-semibold break-words text-slate-800 dark:text-slate-200"
			>
				{formatPersonName(evacuee)}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.nickname}</span>
			<span
				class="mt-0.5 block text-sm font-semibold break-words text-slate-800 dark:text-slate-200"
			>
				{evacuee.nickname || t.unspecified}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.idDocument}</span>
			<span
				class="mt-0.5 block text-sm font-semibold break-words text-slate-800 dark:text-slate-200"
			>
				{t.documents[evacuee.person_id?.cardType ?? 'national_id'] ?? t.documents.other}
			</span>
		</div>
		<div class="min-w-0 sm:col-span-2">
			<span class="block text-xs font-medium text-muted-foreground">{t.documentNumber}</span>
			<span
				class="mt-0.5 block font-mono text-sm font-semibold break-all text-slate-800 dark:text-slate-200"
			>
				{evacuee.person_id?.cardType === 'anonymous'
					? (evacuee.person_id.number ?? '—')
					: maskNationalId(evacuee.person_id?.number)}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.gender}</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{genderLabel(evacuee.gender, langState.current)}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.age}</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{ageYears !== null ? t.ageYears(ageYears) : t.unspecified}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.birthYear}</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.birth_year ? t.beYear(evacuee.birth_year) : t.unspecified}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.nationality}</span>
			<span
				class="mt-0.5 block text-sm font-semibold break-words text-slate-800 dark:text-slate-200"
			>
				{getCountryName(evacuee.country, langState.current)}
			</span>
		</div>
		<div class="min-w-0">
			<span class="block text-xs font-medium text-muted-foreground">{t.religion}</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{(evacuee.religion && t.religions[evacuee.religion]) || t.unspecified}
			</span>
		</div>
		<div class="min-w-0 border-t border-border/50 pt-3 sm:col-span-2">
			<span class="block text-xs font-medium text-muted-foreground">{t.phone}</span>
			<span
				class="mt-0.5 block text-sm font-semibold break-words text-slate-800 dark:text-slate-200"
			>
				{evacuee.phone || t.noPhone}
			</span>
		</div>
	</div>
</section>

<script lang="ts">
	import { goto } from '$app/navigation';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Cloud from '@lucide/svelte/icons/cloud';
	import User from '@lucide/svelte/icons/user';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { maskNationalId, peopleLabels } from '../../domain/people';
	import { STATION1_REGISTRATION_I18N } from '../_constants/station1-registration.i18n';
	import type { InstantDuplicateMatch } from '../../domain/instant-duplicate';

	let {
		open = $bindable(false),
		matches = [],
		queryValue = '',
		thaiId = '',
		fieldType = 'national_id',
		isPublic = false,
		ondismiss
	}: {
		open?: boolean;
		matches?: InstantDuplicateMatch[];
		queryValue?: string;
		thaiId?: string;
		fieldType?: 'national_id' | 'phone';
		isPublic?: boolean;
		ondismiss: () => void;
	} = $props();

	const t = $derived(getTranslation(STATION1_REGISTRATION_I18N, langState.current).duplicate);
	const stayStatusLabels = $derived(peopleLabels(langState.current).stayStatus);

	function matchStatusLabel(match: InstantDuplicateMatch): string {
		return match.source === 'local'
			? `${t.shelterStatusPrefix} — ${stayStatusLabels[match.status as keyof typeof stayStatusLabels] ?? match.status}`
			: t.poolStatus;
	}

	const effectiveValue = $derived(queryValue || thaiId || '');
	const primaryMatch = $derived(matches[0] ?? null);

	function handleProceedNotThisPerson() {
		open = false;
		ondismiss();
	}

	async function handleNavigateToExisting(actionUrl: string) {
		open = false;
		await goto(actionUrl);
	}
</script>

<AlertDialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			ondismiss();
		}
	}}
>
	<AlertDialog.Content class="max-w-lg">
		<AlertDialog.Header class="space-y-2">
			<div class="flex items-center gap-2 text-amber-600 dark:text-amber-500">
				<AlertTriangle class="size-5 shrink-0" />
				<AlertDialog.Title class="text-lg font-bold text-slate-900 dark:text-slate-100">
					{#if isPublic}
						{fieldType === 'phone' ? t.publicPhoneTitle : t.publicIdTitle}
					{:else}
						{fieldType === 'phone' ? t.staffPhoneTitle : t.staffIdTitle}
					{/if}
				</AlertDialog.Title>
			</div>

			<AlertDialog.Description class="text-sm text-slate-600 dark:text-slate-400">
				{#if isPublic}
					{#if fieldType === 'phone'}
						{t.publicPhoneDesc}
					{:else}
						{t.publicIdDesc}
					{/if}
				{:else if fieldType === 'phone'}
					{t.staffPhonePrefix}
					<strong class="font-semibold text-slate-900 tabular-nums dark:text-slate-100"
						>{effectiveValue}</strong
					>
					{t.staffSuffix}
				{:else}
					{t.staffIdPrefix}
					<strong class="font-semibold text-slate-900 tabular-nums dark:text-slate-100"
						>{maskNationalId(effectiveValue || primaryMatch?.nationalId)}</strong
					>
					{t.staffSuffix}
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>

		<!-- Only render specific match details for desk staff (Onsite), NEVER for Public -->
		{#if !isPublic && matches.length > 0}
			<div class="my-2 space-y-2.5">
				{#each matches as match, index (match.id + index)}
					<div
						class="flex flex-col gap-2 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
					>
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
								<User class="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
								<span>{match.name}</span>
							</div>
							<div class="flex items-center gap-1.5">
								{#if match.source === 'local'}
									<Badge
										variant="outline"
										class="gap-1 border-blue-300 bg-blue-50 text-2xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
									>
										<Building2 class="size-3" />
										<span>{t.thisShelter}</span>
									</Badge>
								{:else}
									<Badge
										variant="outline"
										class="gap-1 border-purple-300 bg-purple-50 text-2xs text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
									>
										<Cloud class="size-3" />
										<span>{t.centralQueue}</span>
									</Badge>
								{/if}
								<Badge variant="secondary" class="text-2xs font-medium">
									{matchStatusLabel(match)}
								</Badge>
							</div>
						</div>

						<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							{#if match.nationalId}
								<span
									>{t.idCardLabel}
									<span class="font-mono tabular-nums">{maskNationalId(match.nationalId)}</span
									></span
								>
							{/if}
							{#if match.phone}
								<span>{t.phoneLabel} <span class="font-mono tabular-nums">{match.phone}</span></span
								>
							{/if}
						</div>

						{#if matches.length > 1}
							<div class="pt-1">
								<Button
									type="button"
									size="sm"
									variant="secondary"
									class="h-8 gap-1 text-xs"
									onclick={() => handleNavigateToExisting(match.actionUrl)}
								>
									<span>{t.goToExisting}</span>
									<ArrowRight class="size-3.5" />
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<AlertDialog.Footer class="gap-2 sm:gap-2">
			{#if isPublic}
				<Button
					type="button"
					variant="default"
					class="h-10 w-full rounded-xl bg-amber-600 text-white hover:bg-amber-700 sm:w-auto"
					onclick={handleProceedNotThisPerson}
				>
					{t.acknowledge}
				</Button>
			{:else}
				<Button
					type="button"
					variant="outline"
					class="h-10 rounded-xl"
					onclick={handleProceedNotThisPerson}
				>
					{t.notThisPerson}
				</Button>
				{#if primaryMatch}
					<Button
						type="button"
						variant="default"
						class="h-10 gap-1.5 rounded-xl bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
						onclick={() => handleNavigateToExisting(primaryMatch.actionUrl)}
					>
						<span>{t.goToExisting}</span>
						<ArrowRight class="size-4" />
					</Button>
				{/if}
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

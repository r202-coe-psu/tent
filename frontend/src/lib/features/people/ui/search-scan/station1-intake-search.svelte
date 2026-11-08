<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import X from '@lucide/svelte/icons/x';
	import Zap from '@lucide/svelte/icons/zap';

	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		ClaimDialog,
		UnassignedQueueBadge,
		formatClaimCreatedAt,
		formatOpenMemberDemographicsLine,
		formatOpenMemberIdentityLine,
		formatOpenMemberName,
		formatOpenMemberVulnerableGroup,
		useUnassignedRegistrationSearch,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';

	import { useSearchEvacuees } from '../../application/queries';
	import {
		intakeSearchCopyByLanguage,
		hasFederatedIntakeHits,
		isIntakeNewRegistrationLocked,
		resolveNewRegistrationCta,
		resolveShelterHitAction
	} from '../../domain/intake-search';
	import { formatPersonName, maskNationalId, zoneLabel } from '../../domain/people';
	import { STATION1_INTAKE_I18N } from '../_constants/station1-intake.i18n';
	import { useShelter } from '$lib/features/shelters';
	import RegisteredViaBadge from '../shared/registered-via-badge.svelte';
	import StayStatusBadge from '../shared/stay-status-badge.svelte';

	let {
		canClaimPool = false,
		onNewRegistrationLockedChange,
		onScanClick,
		query = $bindable(''),
		onCodeEnter
	}: {
		/** RBAC: show claim CTA on pool rows (search itself is always on). */
		canClaimPool?: boolean;
		/** Notifies the page when Station 1 hard-gate locks/unlocks new-reg. */
		onNewRegistrationLockedChange?: (locked: boolean) => void;
		/** Opens camera QR scanner modal. */
		onScanClick?: () => void;
		/** Two-way binding for search query so parent page can filter tabs simultaneously. */
		query?: string;
		/** Triggered when Enter is pressed on raw barcode scan. */
		onCodeEnter?: (code: string) => void;
	} = $props();

	const lang = $derived(langState.current);
	const t = $derived(getTranslation(STATION1_INTAKE_I18N, lang));
	const copy = $derived(intakeSearchCopyByLanguage[lang]);

	let debouncedQuery = $state('');
	let claimOpen = $state(false);
	let selected = $state<UnassignedRegistrationSearchHit | null>(null);
	let overrideConfirmed = $state(false);
	let overrideForQuery = $state('');
	let overrideDialogOpen = $state(false);

	let debounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = query.trim();
		clearTimeout(debounceTimer);
		if (!q) {
			debouncedQuery = '';
			return;
		}
		debounceTimer = setTimeout(() => {
			debouncedQuery = q;
		}, 300);
		return () => clearTimeout(debounceTimer);
	});

	const localSearch = useSearchEvacuees(
		() => debouncedQuery,
		() => !!debouncedQuery
	);
	const poolSearch = useUnassignedRegistrationSearch(() => debouncedQuery);
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const localHits = $derived(localSearch.data ?? []);
	const poolHits = $derived(poolSearch.data?.results ?? []);
	const localFetching = $derived(!!debouncedQuery && localSearch.isFetching);
	const poolFetching = $derived(!!debouncedQuery && poolSearch.isFetching);
	const isSearching = $derived(localFetching || poolFetching);
	const hasSearched = $derived(!!debouncedQuery && !localFetching && !poolFetching);
	const poolError = $derived(hasSearched && poolSearch.isError);
	const federatedHits = $derived(hasFederatedIntakeHits(localHits.length, poolHits.length));
	const overrideActive = $derived(overrideConfirmed && overrideForQuery === debouncedQuery);
	const newRegCta = $derived(
		resolveNewRegistrationCta({
			hasSearched,
			poolError,
			hasFederatedHits: federatedHits,
			overrideConfirmed: overrideActive
		})
	);
	const hardLocked = $derived(
		isIntakeNewRegistrationLocked({
			hasSearched,
			poolError,
			hasFederatedHits: federatedHits,
			overrideConfirmed: overrideActive
		})
	);
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const overrideDialogBody = $derived(poolError ? copy.overridePoolErrorBody : copy.overrideBody);
	const lockedHint = $derived(poolError ? copy.newRegPoolErrorLockedHint : copy.newRegLockedHint);

	$effect(() => {
		onNewRegistrationLockedChange?.(hardLocked);
	});

	function clearSearch() {
		query = '';
		debouncedQuery = '';
		selected = null;
		claimOpen = false;
		overrideConfirmed = false;
		overrideForQuery = '';
		overrideDialogOpen = false;
	}

	function goReportIn(id: string) {
		goto(resolve(`/onsite/people/${id}/report-in` as `/onsite/people/${string}/report-in`));
	}

	function goProfile(id: string) {
		goto(
			resolve(
				`/onsite/people/evacuee-profile-view/${id}` as `/onsite/people/evacuee-profile-view/${string}`
			)
		);
	}

	function openClaimModal(hit: UnassignedRegistrationSearchHit) {
		selected = hit;
		claimOpen = true;
	}

	function confirmOverride() {
		overrideConfirmed = true;
		overrideForQuery = debouncedQuery;
		overrideDialogOpen = false;
	}
</script>

<div class="flex w-full flex-col gap-4">
	<div class="flex gap-2">
		<div class="relative flex-1">
			{#if isSearching}
				<Loader2
					class="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 animate-spin text-muted-foreground"
				/>
			{:else}
				<Search
					class="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
				/>
			{/if}
			<Input
				type="text"
				placeholder={copy.searchPlaceholder}
				bind:value={query}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						const trimmed = query.trim();
						if (trimmed && onCodeEnter) {
							e.preventDefault();
							onCodeEnter(trimmed);
						}
					}
				}}
				class="h-12 rounded-xl border-slate-200/80 bg-white pr-10 pl-11 text-base shadow-xs"
				aria-label={copy.searchPlaceholder}
			/>
			{#if query}
				<button
					type="button"
					class="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
					onclick={clearSearch}
					aria-label={t.clearSearchAria}
				>
					<X class="size-4" />
				</button>
			{/if}
		</div>
		{#if onScanClick}
			<Button
				type="button"
				variant="outline"
				class="h-12 shrink-0 gap-2 rounded-xl border-slate-200/80 bg-white px-4 font-medium shadow-xs hover:bg-slate-50"
				onclick={onScanClick}
			>
				<Camera class="size-5 text-primary" />
				<span class="hidden sm:inline">{t.scanQr}</span>
			</Button>
		{/if}
	</div>

	{#if isSearching}
		<div class="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
			<Loader2 class="size-4 animate-spin" />
			{t.searching}
		</div>
	{:else if hasSearched}
		<div class="flex flex-col gap-5">
			{#if localHits.length > 0}
				<section class="space-y-3">
					<h2 class="text-base font-semibold text-slate-900">{t.thisShelter}</h2>
					<ul class="space-y-2.5">
						{#each localHits as evacuee (evacuee._id)}
							{@const action = resolveShelterHitAction(evacuee.current_stay.status)}
							<li
								class="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
							>
								<div class="min-w-0 space-y-1">
									<p class="truncate text-base font-semibold text-slate-900">
										{formatPersonName(evacuee)}
									</p>
									<div class="flex flex-wrap items-center gap-2 text-sm text-slate-500">
										<span class="text-xs">{t.statusLabel}</span>
										<StayStatusBadge status={evacuee.current_stay.status} size="sm" />
										{#if evacuee.current_stay.zone}
											<span class="text-xs text-muted-foreground"
												>· {t.zoneName(zoneLabel(evacuee.current_stay.zone, shelterZones))}</span
											>
										{/if}
										{#if evacuee.person_id?.number}
											<span class="text-xs text-muted-foreground">
												· {t.idCardLabel}
												<span class="tabular-nums">{maskNationalId(evacuee.person_id.number)}</span>
											</span>
										{/if}
										{#if evacuee.phone}
											<span class="text-xs text-muted-foreground">
												· {t.phoneLabel} <span class="tabular-nums">{evacuee.phone}</span>
											</span>
										{/if}
									</div>
								</div>
								{#if action === 'report_in'}
									<Button
										type="button"
										class="h-11 w-full shrink-0 gap-1.5 sm:h-9 sm:w-auto"
										onclick={() => goReportIn(evacuee._id)}
									>
										<Zap class="size-4" />
										{copy.reportInCta}
									</Button>
								{:else}
									<Button
										type="button"
										variant="secondary"
										size="sm"
										class="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
										onclick={() => goProfile(evacuee._id)}
									>
										{t.viewStatus}
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="space-y-3">
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="text-base font-semibold text-slate-900">{t.centralQueue}</h2>
					<UnassignedQueueBadge compact />
				</div>

				{#if poolError}
					<div
						class="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center text-sm text-amber-950 shadow-xs"
					>
						<p>{copy.poolVerifyError}</p>
						<Button type="button" variant="outline" size="sm" onclick={() => poolSearch.refetch()}>
							{t.retry}
						</Button>
					</div>
				{:else if poolHits.length > 0}
					<ul class="space-y-2.5">
						{#each poolHits as hit (hit.id)}
							<li class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
								<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0 space-y-1">
										<div class="flex flex-wrap items-center gap-2">
											<UnassignedQueueBadge compact />
											<RegisteredViaBadge via={hit.registered_via} />
										</div>
										<p class="text-xs text-muted-foreground">
											{t.registeredAt(formatClaimCreatedAt(hit.created_at))}
										</p>
									</div>
									{#if canClaimPool}
										<Button
											type="button"
											size="sm"
											variant="secondary"
											class="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
											onclick={() => openClaimModal(hit)}
										>
											{t.claimIntoShelter}
										</Button>
									{:else}
										<p class="text-xs text-muted-foreground sm:max-w-[12rem] sm:text-right">
											{copy.poolClaimForbiddenHint}
										</p>
									{/if}
								</div>
								<ul class="space-y-2 border-t border-slate-200/80 pt-3">
									{#each hit.open_members as member (member.reserved_evacuee_id)}
										<li class="text-sm">
											<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
											<p class="text-xs text-muted-foreground tabular-nums">
												{formatOpenMemberIdentityLine(member, lang)}
											</p>
											<p class="text-xs text-muted-foreground">
												{formatOpenMemberDemographicsLine(member, lang)}
											</p>
											{#if member.vulnerable_groups.length > 0 || member.special_needs.length > 0}
												<div class="mt-1 flex flex-wrap gap-1.5">
													{#each member.vulnerable_groups as code (code)}
														<span
															class="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs text-rose-900"
														>
															{formatOpenMemberVulnerableGroup(code, lang)}
														</span>
													{/each}
													{#each member.special_needs as need (need)}
														<span
															class="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900"
														>
															{need}
														</span>
													{/each}
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{:else if localHits.length > 0}
					<p class="text-sm text-slate-500">{t.notFoundInPool}</p>
				{/if}
			</section>

			{#if newRegCta === 'prominent'}
				<div
					class="flex flex-col items-stretch gap-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs sm:items-center sm:text-center"
				>
					<div class="space-y-1">
						<h3 class="text-lg font-bold text-slate-900">{t.notFoundTitle}</h3>
						<p class="text-sm text-slate-500">{t.registerNowHint}</p>
					</div>
					<Button
						href={resolve('/onsite/people/new')}
						class="h-12 w-full gap-2 text-base font-semibold sm:max-w-sm"
					>
						<UserPlus class="size-5" />
						{copy.newRegistrationCta}
					</Button>
				</div>
			{:else if newRegCta === 'outlined_override'}
				<Button
					href={resolve('/onsite/people/new')}
					variant="outline"
					size="sm"
					class="h-10 w-full gap-2 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 sm:w-auto"
				>
					<UserPlus class="size-4" />
					{copy.newRegistrationCta}
				</Button>
			{:else if hardLocked}
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-sm text-slate-500">{lockedHint}</p>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="h-10 shrink-0 text-slate-700"
						onclick={() => (overrideDialogOpen = true)}
					>
						{copy.newRegOverrideTrigger}
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<ClaimDialog bind:open={claimOpen} bind:hit={selected} {shelterCode} />

<AlertDialog.Root bind:open={overrideDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{copy.overrideTitle}</AlertDialog.Title>
			<AlertDialog.Description>{overrideDialogBody}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{copy.overrideCancel}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmOverride}>{copy.overrideConfirm}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

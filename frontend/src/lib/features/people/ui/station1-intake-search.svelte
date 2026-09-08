<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import X from '@lucide/svelte/icons/x';

	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		ClaimDialog,
		UnassignedQueueBadge,
		formatOpenMemberName,
		useUnassignedRegistrationSearch,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';

	import { useSearchEvacuees } from '../application/queries';
	import {
		INTAKE_SEARCH_PLACEHOLDER,
		NEW_REGISTRATION_CTA_LABEL,
		NEW_REG_LOCKED_HINT,
		NEW_REG_OVERRIDE_TRIGGER_LABEL,
		NEW_REG_POOL_ERROR_LOCKED_HINT,
		OVERRIDE_NEW_REG_BODY,
		OVERRIDE_NEW_REG_CANCEL,
		OVERRIDE_NEW_REG_CONFIRM,
		OVERRIDE_NEW_REG_POOL_ERROR_BODY,
		OVERRIDE_NEW_REG_TITLE,
		POOL_CLAIM_FORBIDDEN_HINT,
		POOL_VERIFY_ERROR_COPY,
		REPORT_IN_CTA_LABEL,
		hasFederatedIntakeHits,
		isIntakeNewRegistrationLocked,
		resolveNewRegistrationCta,
		resolveShelterHitAction,
		shelterHitStatusLabel
	} from '../domain/intake-search';
	import { formatPersonName, maskNationalId } from '../domain/people';

	let {
		canClaimPool = false,
		onNewRegistrationLockedChange
	}: {
		/** RBAC: show claim CTA on pool rows (search itself is always on). */
		canClaimPool?: boolean;
		/** Notifies the page when Station 1 hard-gate locks/unlocks new-reg. */
		onNewRegistrationLockedChange?: (locked: boolean) => void;
	} = $props();

	let query = $state('');
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
	const overrideDialogBody = $derived(
		poolError ? OVERRIDE_NEW_REG_POOL_ERROR_BODY : OVERRIDE_NEW_REG_BODY
	);
	const lockedHint = $derived(poolError ? NEW_REG_POOL_ERROR_LOCKED_HINT : NEW_REG_LOCKED_HINT);

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
	<div class="relative">
		{#if isSearching}
			<Loader2
				class="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 animate-spin text-muted-foreground"
			/>
		{:else}
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
			/>
		{/if}
		<Input
			type="text"
			placeholder={INTAKE_SEARCH_PLACEHOLDER}
			bind:value={query}
			class="h-12 border-slate-200/80 bg-white pr-10 pl-11 text-base shadow-xs"
			aria-label={INTAKE_SEARCH_PLACEHOLDER}
		/>
		{#if query}
			<button
				type="button"
				class="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-slate-700"
				onclick={clearSearch}
				aria-label="ล้างคำค้น"
			>
				<X class="size-4" />
			</button>
		{/if}
	</div>

	{#if isSearching}
		<div class="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
			<Loader2 class="size-4 animate-spin" />
			กำลังค้นหา...
		</div>
	{:else if hasSearched}
		<div class="flex flex-col gap-5">
			{#if localHits.length > 0}
				<section class="space-y-3">
					<h2 class="text-base font-semibold text-slate-900">ในศูนย์นี้</h2>
					<ul class="space-y-2.5">
						{#each localHits as evacuee (evacuee._id)}
							{@const action = resolveShelterHitAction(evacuee.current_stay.status)}
							{@const statusLabel = shelterHitStatusLabel(evacuee.current_stay.status)}
							<li
								class="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
							>
								<div class="min-w-0 space-y-1">
									<p class="truncate text-base font-semibold text-slate-900">
										{formatPersonName(evacuee)}
									</p>
									<p class="text-sm text-slate-500">
										สถานะ: <span class="font-medium text-slate-700">{statusLabel}</span>
										{#if evacuee.person_id?.number}
											· เลขบัตร: <span class="tabular-nums"
												>{maskNationalId(evacuee.person_id.number)}</span
											>
										{/if}
										{#if evacuee.phone}
											· โทร: <span class="tabular-nums">{evacuee.phone}</span>
										{/if}
									</p>
								</div>
								{#if action === 'report_in'}
									<Button
										type="button"
										class="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
										onclick={() => goReportIn(evacuee._id)}
									>
										{REPORT_IN_CTA_LABEL}
									</Button>
								{:else}
									<Button
										type="button"
										variant="secondary"
										size="sm"
										class="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
										onclick={() => goProfile(evacuee._id)}
									>
										ดูสถานะ
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="space-y-3">
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="text-base font-semibold text-slate-900">คิวกลาง</h2>
					<UnassignedQueueBadge compact />
				</div>

				{#if poolError}
					<div
						class="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center text-sm text-amber-950 shadow-xs"
					>
						<p>{POOL_VERIFY_ERROR_COPY}</p>
						<Button type="button" variant="outline" size="sm" onclick={() => poolSearch.refetch()}>
							ลองอีกครั้ง
						</Button>
					</div>
				{:else if poolHits.length > 0}
					<ul class="space-y-2.5">
						{#each poolHits as hit (hit.id)}
							<li class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
								<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0 space-y-1">
										<p class="text-xs font-semibold text-slate-500">รหัสเอกสาร</p>
										<p class="text-sm break-all text-slate-900 tabular-nums">{hit.id}</p>
										<p class="text-xs text-muted-foreground">
											สร้างเมื่อ {hit.created_at.slice(0, 16).replace('T', ' ')}
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
											รับเข้าศูนย์
										</Button>
									{:else}
										<p class="text-xs text-muted-foreground sm:max-w-[12rem] sm:text-right">
											{POOL_CLAIM_FORBIDDEN_HINT}
										</p>
									{/if}
								</div>
								<ul class="space-y-2 border-t border-slate-200/80 pt-3">
									{#each hit.open_members as member (member.reserved_evacuee_id)}
										<li class="text-sm">
											<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
											<p class="text-xs text-muted-foreground tabular-nums">
												{member.phone ?? 'ไม่มีเบอร์'} · {member.person_id?.number ??
													'ไม่มีเลขบัตร'}
											</p>
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				{:else if localHits.length > 0}
					<p class="text-sm text-slate-500">ไม่พบในคิวกลาง</p>
				{/if}
			</section>

			{#if newRegCta === 'prominent'}
				<div
					class="flex flex-col items-stretch gap-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs sm:items-center sm:text-center"
				>
					<div class="space-y-1">
						<h3 class="text-lg font-bold text-slate-900">ไม่พบรายการ</h3>
						<p class="text-sm text-slate-500">ลงทะเบียนใหม่ได้ทันที</p>
					</div>
					<Button
						href={resolve('/onsite/people/new')}
						class="h-12 w-full gap-2 text-base font-semibold sm:max-w-sm"
					>
						<UserPlus class="size-5" />
						{NEW_REGISTRATION_CTA_LABEL}
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
					{NEW_REGISTRATION_CTA_LABEL}
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
						{NEW_REG_OVERRIDE_TRIGGER_LABEL}
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
			<AlertDialog.Title>{OVERRIDE_NEW_REG_TITLE}</AlertDialog.Title>
			<AlertDialog.Description>{overrideDialogBody}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{OVERRIDE_NEW_REG_CANCEL}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmOverride}>{OVERRIDE_NEW_REG_CONFIRM}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import X from '@lucide/svelte/icons/x';

	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		CLAIM_FLOW_STATUS_GUIDANCE,
		formatOpenMemberName,
		isOnlineRequiredError,
		pickReportInEvacueeId,
		toggleMemberSelection,
		UnassignedQueueBadge,
		UnassignedRegistrationApiError,
		useClaimUnassignedRegistration,
		useUnassignedRegistrationSearch,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';

	import { useSearchEvacuees } from '../application/queries';
	import {
		INTAKE_SEARCH_PLACEHOLDER,
		NEW_REGISTRATION_CTA_LABEL,
		REPORT_IN_CTA_LABEL,
		isIntakeNotFoundState,
		resolveShelterHitAction,
		shelterHitStatusLabel
	} from '../domain/intake-search';
	import { formatPersonName, maskNationalId } from '../domain/people';

	let {
		enableCentralPool = false
	}: {
		/** When true, also search Mongo central pool (#250) and show claim CTAs. */
		enableCentralPool?: boolean;
	} = $props();

	let query = $state('');
	let debouncedQuery = $state('');
	let claimOpen = $state(false);
	let selected = $state<UnassignedRegistrationSearchHit | null>(null);
	let selectedMemberIds = $state<string[]>([]);

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
	const poolSearch = useUnassignedRegistrationSearch(() =>
		enableCentralPool && debouncedQuery ? debouncedQuery : ''
	);
	const claimMutation = useClaimUnassignedRegistration();

	const localHits = $derived(localSearch.data ?? []);
	const poolHits = $derived(enableCentralPool ? (poolSearch.data?.results ?? []) : []);
	const localFetching = $derived(!!debouncedQuery && localSearch.isFetching);
	const poolFetching = $derived(enableCentralPool && !!debouncedQuery && poolSearch.isFetching);
	const isSearching = $derived(localFetching || poolFetching);
	const hasSearched = $derived(
		!!debouncedQuery && !localFetching && (!enableCentralPool || !poolFetching)
	);
	const poolError = $derived(enableCentralPool && hasSearched && poolSearch.isError);
	const showNotFound = $derived(
		!poolError &&
			isIntakeNotFoundState({
				hasSearched,
				localHitCount: localHits.length,
				centralPoolHitCount: poolHits.length
			})
	);
	const hasHits = $derived(localHits.length > 0 || poolHits.length > 0);
	const onlineRequired = $derived(
		poolError &&
			(isOnlineRequiredError(poolSearch.error) ||
				(poolSearch.error instanceof UnassignedRegistrationApiError &&
					poolSearch.error.code === 'ONLINE_REQUIRED'))
	);
	const canClaim = $derived(selectedMemberIds.length > 0 && !claimMutation.isPending);
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	function clearSearch() {
		query = '';
		debouncedQuery = '';
		selected = null;
		claimOpen = false;
		selectedMemberIds = [];
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
		selectedMemberIds = [];
		claimOpen = true;
	}

	function setMemberChecked(memberId: string, checked: boolean | 'indeterminate') {
		selectedMemberIds = toggleMemberSelection(selectedMemberIds, memberId, checked === true);
	}

	async function submitClaim() {
		if (!selected || selectedMemberIds.length === 0) return;
		const registrationId = selected.id;
		try {
			const result = await claimMutation.mutateAsync({
				registrationId,
				payload: {
					member_ids: selectedMemberIds,
					...(shelterCode ? { shelter_code: shelterCode } : {})
				}
			});
			const reportInId = pickReportInEvacueeId(result.evacuee_ids);
			claimOpen = false;
			selected = null;
			selectedMemberIds = [];
			if (reportInId) {
				await goto(
					resolve(`/onsite/people/${reportInId}/report-in` as `/onsite/people/${string}/report-in`)
				);
			}
		} catch {
			// toast handled in mutation onError
		}
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

			{#if enableCentralPool}
				<section class="space-y-3">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-base font-semibold text-slate-900">คิวกลาง</h2>
						<UnassignedQueueBadge compact />
					</div>

					{#if poolError}
						<div
							class="flex flex-col items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center text-sm text-amber-950 shadow-xs"
						>
							<p>
								{#if onlineRequired}
									ต้องเชื่อมต่อส่วนกลางเพื่อค้นหาคิวลงทะเบียนล่วงหน้า (ไม่ระบุศูนย์)
								{:else}
									ค้นหาไม่สำเร็จ — ตรวจสอบการเชื่อมต่อส่วนกลางแล้วลองใหม่
								{/if}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={() => poolSearch.refetch()}
							>
								ลองอีกครั้ง
							</Button>
						</div>
					{:else if poolHits.length > 0}
						<ul class="space-y-2.5">
							{#each poolHits as hit (hit.id)}
								<li class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
									<div
										class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
									>
										<div class="min-w-0 space-y-1">
											<p class="text-xs font-semibold text-slate-500">รหัสเอกสาร</p>
											<p class="text-sm break-all text-slate-900 tabular-nums">{hit.id}</p>
											<p class="text-xs text-muted-foreground">
												สร้างเมื่อ {hit.created_at.slice(0, 16).replace('T', ' ')}
											</p>
										</div>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											class="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
											onclick={() => openClaimModal(hit)}
										>
											รับเข้าศูนย์
										</Button>
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
						<p class="text-sm text-slate-500">ไม่พบสมาชิก open ในคิวกลางที่ตรงกับคำค้น</p>
					{/if}
				</section>
			{/if}

			{#if showNotFound}
				<div
					class="flex flex-col items-stretch gap-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs sm:items-center sm:text-center"
				>
					<div class="space-y-1">
						<h3 class="text-lg font-bold text-slate-900">ไม่พบรายการที่ตรงกัน</h3>
						<p class="text-sm text-slate-500">
							ไม่พบผู้พักพิงในศูนย์นี้{#if enableCentralPool}
								และคิวกลาง{/if} — ลงทะเบียนใหม่ได้ทันที
						</p>
					</div>
					<Button
						href={resolve('/onsite/people/new')}
						class="h-12 w-full gap-2 text-base font-semibold sm:max-w-sm"
					>
						<UserPlus class="size-5" />
						{NEW_REGISTRATION_CTA_LABEL}
					</Button>
				</div>
			{:else if hasHits}
				<Button
					href={resolve('/onsite/people/new')}
					variant="outline"
					size="sm"
					class="h-10 w-full gap-2 border-slate-200/80 text-slate-700 sm:w-auto"
				>
					<UserPlus class="size-4" />
					ลงทะเบียนใหม่
				</Button>
			{/if}
		</div>
	{/if}
</div>

<Dialog.Root bind:open={claimOpen}>
	<Dialog.Content class="flex max-h-[90vh] flex-col gap-4 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>รับเข้าศูนย์ (claim)</Dialog.Title>
			<Dialog.Description>
				{CLAIM_FLOW_STATUS_GUIDANCE}
			</Dialog.Description>
		</Dialog.Header>
		{#if selected}
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-sm">
				<div class="rounded-xl border border-slate-200/80 bg-white p-3">
					<div class="mb-2">
						<UnassignedQueueBadge />
					</div>
					<p class="text-xs font-semibold text-slate-500">รหัสเอกสาร</p>
					<p class="break-all text-slate-900 tabular-nums">{selected.id}</p>
					<p class="mt-2 text-xs font-semibold text-slate-500">ครัวเรือนสำรอง</p>
					<p class="break-all text-slate-900 tabular-nums">{selected.reserved_household_id}</p>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<p class="mb-2 text-sm font-semibold text-slate-900">สมาชิกที่ยัง open</p>
					<ul class="space-y-2">
						{#each selected.open_members as member (member.reserved_evacuee_id)}
							<li class="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
								<div class="flex items-start gap-3">
									<Checkbox
										checked={selectedMemberIds.includes(member.reserved_evacuee_id)}
										onCheckedChange={(v) => setMemberChecked(member.reserved_evacuee_id, v)}
										class="mt-1"
										aria-label={`เลือก ${formatOpenMemberName(member)}`}
									/>
									<div class="min-w-0 flex-1">
										<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
										<p class="text-xs text-muted-foreground tabular-nums">
											{member.phone ?? 'ไม่มีเบอร์'} · {member.person_id?.number ?? 'ไม่มีเลขบัตร'}
										</p>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
				<div class="flex flex-col gap-2 border-t border-slate-200/80 pt-3">
					<p class="text-xs text-muted-foreground">
						เลือกแล้ว {selectedMemberIds.length} / {selected.open_members.length} คน · คนที่ไม่ติ๊กยังคง
						open ในคิวกลาง
					</p>
					<Button type="button" disabled={!canClaim} onclick={submitClaim} class="w-full">
						{#if claimMutation.isPending}
							กำลังรับเข้าศูนย์...
						{:else}
							ยืนยันรับเข้าศูนย์
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

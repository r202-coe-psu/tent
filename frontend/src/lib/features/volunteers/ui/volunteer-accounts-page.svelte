<script lang="ts">
	/**
	 * "บัญชีจิตอาสา" — `/back-office/volunteers/accounts` (CR-221 FR-5, FR-8). Every volunteer
	 * account of the active shelter with its roles here: who it is, what it may do, until when and
	 * who gave it, plus the same access buttons as the people tab (`VolunteerAccessActions`, FR-9).
	 *
	 * One request for the accounts (`useShelterVolunteerAccounts`, FR-6 / FR-7: linked both ways,
	 * lapsed and closed ones included) joined to the shelter's volunteer profiles, which give the
	 * person's name. Search and filters run client-side over that list (`volunteer-account-list.ts`).
	 */
	import Clock from '@lucide/svelte/icons/clock';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Search from '@lucide/svelte/icons/search';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Button } from '$lib/components/ui/button/index.js';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { resolve } from '$app/paths';
	import { canAccessVolunteerBackoffice } from '$lib/auth/roles';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { formatThaiShortDate } from '$lib/utils/date';
	import VolunteerAccessActions from './volunteer-access-actions.svelte';
	import VolunteerAccountBadge from './volunteer-account-badge.svelte';
	import { createMinuteClock } from './minute-clock.svelte';
	import {
		useReactivateVolunteer,
		useShelterVolunteerAccounts,
		useVolunteers
	} from '../application/queries';
	import {
		ACCOUNT_LIST_FILTERS,
		MANAGER_ISSUER_LABEL,
		buildAccountRows,
		countAccountRows,
		filterAccountRows,
		isEndingSoon,
		type AccountListFilter
	} from '../domain/volunteer-account-list';
	import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const shelterLine = $derived.by(() => {
		const shelter = shelterQuery.data;
		if (!shelter?.name) return '—';
		return shelter.shelter_type ? `${shelter.name} (${shelter.shelter_type})` : shelter.name;
	});

	// The server 403s anyone but SA / SM / coordinator of the shelter; the route guard keeps the rest out.
	const canRead = $derived(canAccessVolunteerBackoffice(authStore.user?.roles ?? [], shelterCode));
	const accountsQuery = useShelterVolunteerAccounts(
		() => shelterCode,
		() => canRead
	);
	const volunteersQuery = useVolunteers();

	// A closed profile reopens here too (#984 rule: SA / SM / coordinator, the same as `canRead`),
	// so its access can be given again without going back to the people tab.
	const reactivateMutation = useReactivateVolunteer(useQueryClient());
	let reopeningId = $state<string | null>(null);

	function reopen(volunteer: { _id: string; first_name: string; last_name: string }) {
		const name = `${volunteer.first_name} ${volunteer.last_name}`.trim();
		reopeningId = volunteer._id;
		reactivateMutation.mutate(volunteer._id, {
			onSuccess: () => toast.success(`เปิดใช้งานอาสาสมัคร ${name} อีกครั้งแล้ว`),
			onError: (error) =>
				toast.error(error instanceof Error ? error.message : 'เปิดใช้งานอาสาสมัครไม่สำเร็จ'),
			onSettled: () => (reopeningId = null)
		});
	}

	const { now } = createMinuteClock();

	let search = $state('');
	let filter = $state<AccountListFilter>('all');

	const rows = $derived(buildAccountRows(accountsQuery.data ?? [], volunteersQuery.data ?? []));
	const counts = $derived(countAccountRows(rows, now.getTime()));
	const visibleRows = $derived(filterAccountRows(rows, { search, filter, now: now.getTime() }));

	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	$effect(() => {
		void search;
		void filter;
		currentPage = 1;
	});

	const totalFiltered = $derived(visibleRows.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE)));
	const safePage = $derived(Math.max(1, Math.min(currentPage, totalPages)));
	const paginatedRows = $derived(
		visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
	);

	const isPending = $derived(accountsQuery.isPending || volunteersQuery.isPending);
	const loadError = $derived(accountsQuery.error ?? volunteersQuery.error);

	/** The roles get their own columns here, so the badge only says whether the account is usable. */
	function badgeStatus(status: VolunteerAccessStatus): VolunteerAccessStatus {
		return status.kind === 'active' ? { ...status, roles: [] } : status;
	}

	const skeletonKeys = [0, 1, 2, 3, 4];
	const headClass = 'p-4 text-sm font-bold whitespace-normal text-foreground/70';
	const cellClass = 'p-4 align-top whitespace-normal';
	/** One role per line in the three role columns, so a row with several roles lines up. */
	const lineClass = 'flex min-h-7 flex-wrap items-center gap-1.5 text-sm';
</script>

<StaffPageShell
	title="บัญชีจิตอาสา"
	description="บัญชีเข้าใช้ระบบของอาสาสมัครในศูนย์นี้ ตำแหน่งที่ได้รับ วันหมดอายุ และผู้ออกสิทธิ์"
	maxWidth="7xl"
>
	{#snippet actions()}
		<a
			href={resolve('/back-office/volunteers')}
			class="inline-flex min-h-11 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
		>
			ไปที่รายชื่ออาสาสมัคร
		</a>
	{/snippet}

	<div class="space-y-4">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				placeholder="ค้นหาชื่อหรืออีเมล..."
				aria-label="ค้นหาชื่อหรืออีเมล"
				bind:value={search}
				class="h-11 rounded-xl bg-background pl-9 shadow-xs"
			/>
		</div>

		<div class="flex flex-wrap items-center gap-2" role="group" aria-label="กรองตามสถานะสิทธิ์">
			{#each ACCOUNT_LIST_FILTERS as option (option.value)}
				{@const selected = filter === option.value}
				<button
					type="button"
					aria-pressed={selected}
					class="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {selected
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-border bg-background text-muted-foreground hover:bg-muted'}"
					onclick={() => (filter = option.value)}
				>
					{option.label}
					<span class="tabular-nums" data-testid="filter-count-{option.value}">
						{counts[option.value]}
					</span>
				</button>
			{/each}
		</div>

		{#if isPending}
			<div class="space-y-3" data-testid="accounts-loading">
				{#each skeletonKeys as key (key)}
					<Skeleton class="h-20 rounded-2xl" />
				{/each}
			</div>
		{:else if loadError}
			<p
				role="alert"
				class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
			>
				โหลดบัญชีจิตอาสาไม่สำเร็จ: {loadError instanceof Error
					? loadError.message
					: 'เกิดข้อผิดพลาด'}
			</p>
		{:else if visibleRows.length === 0}
			<div
				class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
			>
				<Inbox class="h-8 w-8" />
				<p class="text-sm font-medium">
					{rows.length === 0
						? 'ยังไม่มีบัญชีจิตอาสาในศูนย์นี้'
						: 'ไม่มีบัญชีที่ตรงกับคำค้นหาหรือตัวกรองที่เลือก'}
				</p>
			</div>
		{:else}
			<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
				<Table.Root class="min-w-[60rem]">
					<Table.Header class="bg-muted/30">
						<Table.Row class="hover:bg-transparent">
							<Table.Head class="{headClass} w-[18%]">ชื่อ</Table.Head>
							<Table.Head class="{headClass} w-[22%]">บัญชี</Table.Head>
							<Table.Head class="{headClass} w-[16%]">ตำแหน่ง</Table.Head>
							<Table.Head class="{headClass} w-[13%]">หมดอายุ</Table.Head>
							<Table.Head class="{headClass} w-[15%]">ออกโดย</Table.Head>
							<Table.Head class="{headClass} w-[16%]">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each paginatedRows as row (row.volunteer._id)}
							<Table.Row data-testid="account-row">
								<Table.Cell class="{cellClass} text-sm font-medium text-foreground">
									<p>{row.displayName}</p>
									{#if row.profileClosed}
										<Badge variant="outline" class="mt-1 text-muted-foreground">
											โปรไฟล์ถูกปิด
										</Badge>
									{/if}
								</Table.Cell>

								<Table.Cell class={cellClass}>
									<VolunteerAccountBadge status={badgeStatus(row.status)} />
								</Table.Cell>

								<Table.Cell class={cellClass}>
									{#each row.roles as role (role.role)}
										<p class={lineClass}>{role.label}</p>
									{:else}
										<p class="{lineClass} text-muted-foreground">—</p>
									{/each}
								</Table.Cell>

								<Table.Cell class={cellClass}>
									{#each row.roles as role (role.role)}
										<p class={lineClass}>
											{#if role.expiresAt === null}
												ถาวร
											{:else}
												<span class="tabular-nums">{formatThaiShortDate(role.expiresAt)}</span>
												{#if row.status.kind === 'active' && isEndingSoon(role.expiresAt, now.getTime())}
													<Badge
														variant="outline"
														class="gap-1 border-amber-300 bg-amber-50 text-amber-800"
													>
														<Clock class="h-3 w-3" />
														ใกล้หมดอายุ
													</Badge>
												{/if}
											{/if}
										</p>
									{:else}
										<p class="{lineClass} text-muted-foreground">—</p>
									{/each}
								</Table.Cell>

								<Table.Cell class={cellClass}>
									{#each row.roles as role (role.role)}
										<p class="{lineClass} break-all">{role.grantedBy ?? MANAGER_ISSUER_LABEL}</p>
									{:else}
										<p class="{lineClass} text-muted-foreground">—</p>
									{/each}
								</Table.Cell>

								<Table.Cell class={cellClass}>
									<VolunteerAccessActions
										volunteer={row.volunteer}
										status={row.status}
										{shelterLine}
									/>
									{#if row.profileClosed && canRead}
										<Button
											size="sm"
											variant="outline"
											class="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
											disabled={reopeningId !== null}
											onclick={() => reopen(row.volunteer)}
										>
											<RotateCcw class="h-3.5 w-3.5" />
											{reopeningId === row.volunteer._id
												? 'กำลังเปิดใช้งาน...'
												: 'เปิดใช้งานอีกครั้ง'}
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if totalPages > 1}
				<div class="flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
					<p class="text-xs text-muted-foreground">
						แสดงบัญชีที่ {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(
							safePage * PAGE_SIZE,
							totalFiltered
						)} จากทั้งหมด {totalFiltered} บัญชี
					</p>
					<PaginationControls bind:page={currentPage} count={totalFiltered} perPage={PAGE_SIZE} />
				</div>
			{/if}
		{/if}
	</div>
</StaffPageShell>

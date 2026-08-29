<script lang="ts">
	/**
	 * Tab 3 — "รายชื่อและการอนุมัติ / People" (owner-approved mockup,
	 * 2026-08-28; switched the roster from a stack of div-grid cards to a real
	 * `Table.Root`/`Table.Header`/`Table.Body` 2026-08-30 so rows sit flush
	 * against each other under one column-label header, mirroring
	 * `users/ui/user-list.svelte`). Composes the stat pills, search/filter bar,
	 * the "รออนุมัติ" sub-filter chips, and the roster table; owns the transfer +
	 * walk-in registration dialogs. `volunteer-card.svelte` (per-row
	 * `Table.Row`) owns the per-row action dialogs.
	 *
	 * Every filter here runs client-side over one unfiltered `useVolunteers()`
	 * fetch (mirrors `job-board-tab.svelte`'s `useJobs()` + in-memory
	 * `$derived.by` filtering) rather than round-tripping through
	 * `VolunteerFilter` per keystroke/toggle.
	 */
	import Inbox from '@lucide/svelte/icons/inbox';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import Zap from '@lucide/svelte/icons/zap';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
	import VolunteerStatPills, { type PeopleStatFilter } from './volunteer-stat-pills.svelte';
	import VolunteerFilterBar from './volunteer-filter-bar.svelte';
	import VolunteerApprovalChips, { type ApprovalChip } from './volunteer-approval-chips.svelte';
	import VolunteerCard from './volunteer-card.svelte';
	import VolunteerTransferDialog from './volunteer-transfer-dialog.svelte';
	import WalkInRegistrationDialog from './walk-in-registration-dialog.svelte';
	import { useVolunteers, useTodayAttendance, useTransfers } from '../application/queries';
	import { isControlledSkill } from '../domain/skills';
	import type { PersonnelType, Volunteer, VolunteerSource } from '../domain/volunteer.schema';
	import type { ShiftAssignment, ShiftAssignmentStatus } from '../domain/shift-assignment.schema';

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);

	const volunteersQuery = useVolunteers();
	const attendanceQuery = useTodayAttendance();
	const incomingTransfersQuery = useTransfers({ status: 'pending' });

	const volunteers = $derived(volunteersQuery.data ?? []);
	const attendanceByVolunteer = $derived.by(() => {
		const map = new SvelteMap<string, ShiftAssignment>();
		for (const a of attendanceQuery.data ?? []) {
			// Today's roster can hold >1 row per volunteer; the roster card only
			// has room for one line, so the first assignment found wins.
			if (!map.has(a.volunteer_id)) map.set(a.volunteer_id, a);
		}
		return map;
	});
	const incomingTransferCount = $derived(
		(incomingTransfersQuery.data ?? []).filter((t) => t.to_shelter_code === shelterCode).length
	);

	let statFilter = $state<PeopleStatFilter>('all');
	let approvalChip = $state<ApprovalChip>('all');
	let search = $state('');
	let skillFilter = $state('');
	let shiftStatusFilter = $state<ShiftAssignmentStatus | ''>('');
	let sourceFilter = $state<VolunteerSource | ''>('');
	let personnelTypeFilter = $state<PersonnelType | ''>('');

	const pendingCount = $derived(volunteers.filter((v) => !v.identity_verified).length);
	const readyCount = $derived(volunteers.filter((v) => v.identity_verified).length);

	function matchesSearch(v: Volunteer, term: string): boolean {
		if (!term) return true;
		const needle = term.trim().toLowerCase();
		if (!needle) return true;
		return (
			v.first_name.toLowerCase().includes(needle) ||
			v.last_name.toLowerCase().includes(needle) ||
			(v.phone ?? '').includes(needle) ||
			v.volunteer_code.toLowerCase().includes(needle)
		);
	}

	const filteredVolunteers = $derived.by<Volunteer[]>(() => {
		let list = volunteers;

		if (statFilter === 'pending') list = list.filter((v) => !v.identity_verified);
		else if (statFilter === 'ready') list = list.filter((v) => v.identity_verified);

		if (statFilter === 'pending' && approvalChip === 'skill_cert') {
			list = list.filter((v) => v.skills.some((s) => isControlledSkill(s)));
		} else if (statFilter === 'pending' && approvalChip === 'shift') {
			// "รอเข้ากะ" has no backing data yet — see `volunteer-approval-chips.svelte`.
			list = [];
		}

		if (search) list = list.filter((v) => matchesSearch(v, search));
		if (skillFilter) list = list.filter((v) => v.skills.includes(skillFilter));
		if (sourceFilter) list = list.filter((v) => v.source === sourceFilter);
		if (personnelTypeFilter) list = list.filter((v) => v.personnel_type === personnelTypeFilter);
		if (shiftStatusFilter) {
			list = list.filter((v) => attendanceByVolunteer.get(v._id)?.status === shiftStatusFilter);
		}

		return list;
	});

	let transferDialogOpen = $state(false);
	let walkInDialogOpen = $state(false);

	const cardSkeletonKeys = [0, 1, 2, 3];
</script>

<div class="space-y-4">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		{#if volunteersQuery.isPending}
			<div class="flex gap-2">
				{#each [0, 1, 2] as key (key)}
					<Skeleton class="h-10 w-28 rounded-xl" />
				{/each}
			</div>
		{:else}
			<VolunteerStatPills
				total={volunteers.length}
				pending={pendingCount}
				ready={readyCount}
				bind:selected={statFilter}
			/>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				class="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
				onclick={() => (transferDialogOpen = true)}
			>
				<ArrowLeftRight class="h-4 w-4" />
				ขอโอนย้ายศูนย์
				{#if incomingTransferCount > 0}
					<Badge class="bg-amber-400 text-[10px] text-amber-950">{incomingTransferCount}</Badge>
				{/if}
			</Button>
			<Button class="gap-1.5" onclick={() => (walkInDialogOpen = true)}>
				<Zap class="h-4 w-4" />
				ลงทะเบียนอาสา Walk-in
			</Button>
		</div>
	</div>

	<VolunteerFilterBar
		bind:search
		bind:skill={skillFilter}
		bind:shiftStatus={shiftStatusFilter}
		bind:source={sourceFilter}
		bind:personnelType={personnelTypeFilter}
	/>

	{#if statFilter === 'pending'}
		<VolunteerApprovalChips
			countAll={pendingCount}
			countIdentity={pendingCount}
			countSkillCert={volunteers.filter(
				(v) => !v.identity_verified && v.skills.some((s) => isControlledSkill(s))
			).length}
			bind:selected={approvalChip}
		/>
	{/if}

	{#if volunteersQuery.isPending}
		<div class="space-y-3">
			{#each cardSkeletonKeys as key (key)}
				<Skeleton class="h-36 rounded-2xl" />
			{/each}
		</div>
	{:else if volunteersQuery.isError}
		<p
			class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
		>
			โหลดรายชื่ออาสาสมัครไม่สำเร็จ: {volunteersQuery.error instanceof Error
				? volunteersQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else if filteredVolunteers.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
		>
			<Inbox class="h-8 w-8" />
			<p class="text-sm font-medium">
				{volunteers.length === 0
					? 'ยังไม่มีอาสาสมัครในศูนย์นี้'
					: 'ไม่มีรายชื่อที่ตรงกับตัวกรองที่เลือก'}
			</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
			<Table.Root>
				<Table.Header class="bg-muted/30">
					<Table.Row class="hover:bg-transparent">
						<Table.Head class="w-[27%] p-4 text-sm font-bold whitespace-normal text-foreground/70">
							ข้อมูลบุคคล (VOLUNTEER INFO)
						</Table.Head>
						<Table.Head class="w-[16%] p-4 text-sm font-bold whitespace-normal text-foreground/70">
							ทักษะ (SKILLS)
						</Table.Head>
						<Table.Head class="w-[17%] p-4 text-sm font-bold whitespace-normal text-foreground/70">
							สังกัดศูนย์ (SHELTER)
						</Table.Head>
						<Table.Head class="w-[19%] p-4 text-sm font-bold whitespace-normal text-foreground/70">
							สถานะยืนยันตัวตน &amp; กะงาน
						</Table.Head>
						<Table.Head class="w-[21%] p-4 text-sm font-bold whitespace-normal text-foreground/70">
							จัดการ (ACTIONS)
						</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filteredVolunteers as volunteer (volunteer._id)}
						<VolunteerCard
							{volunteer}
							shelterName={shelterQuery.data?.name}
							shelterType={shelterQuery.data?.shelter_type}
							todayAssignment={attendanceByVolunteer.get(volunteer._id)}
						/>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<VolunteerTransferDialog bind:open={transferDialogOpen} />
<WalkInRegistrationDialog bind:open={walkInDialogOpen} />

<script lang="ts">
	/**
	 * Job detail screen (01-tab-job-board.md §01.5, approved mockup 2026-08-27)
	 * — hero summary + 3 tabs. Composed here rather than in the route so the
	 * route stays a thin shell, as every other feature in this codebase does.
	 *
	 * Tab 3 (ผู้สมัคร / Applicants & Queue) is intentionally a placeholder: the
	 * approve/reject queue and the dispatch panel both need the volunteer
	 * roster screen, which is a later step. The tab still shows its real
	 * applicant count so the number is never fabricated.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Building from '@lucide/svelte/icons/building';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Users from '@lucide/svelte/icons/users';
	import Construction from '@lucide/svelte/icons/construction';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { useShelter } from '$lib/features/shelters';
	import JobDetailHero from './job-detail-hero.svelte';
	import JobDetailOverviewTab from './job-detail-overview-tab.svelte';
	import JobShiftsTab from './job-shifts-tab.svelte';
	import JobFormDialog from './job-form-dialog.svelte';
	import { useJob, useJobApplications } from '../application/queries';

	let { jobId }: { jobId: string } = $props();

	const jobQuery = useJob(() => jobId);
	/**
	 * `useJobApplications(filter)` takes its filter once at setup, so passing
	 * `{ jobId }` would freeze the count to whichever job was first rendered
	 * (SvelteKit reuses this component across `[id]` navigations). Count off the
	 * unfiltered list instead — the same thing `job-board-tab.svelte` does.
	 */
	const applicationsQuery = useJobApplications();

	const job = $derived(jobQuery.data ?? null);
	const applicantCount = $derived(
		(applicationsQuery.data ?? []).filter((a) => a.job_id === jobId).length
	);

	const shelterQuery = useShelter(() => job?.shelter_code ?? '');
	const shelterLabel = $derived(shelterQuery.data?.name ?? job?.shelter_code ?? '—');

	type DetailTab = 'overview' | 'shifts' | 'applicants';

	/**
	 * Local, not URL state. The board page keeps its tab in `?tab=` because a
	 * refresh there should land back on the same tab; here the tab is a view of
	 * one job, and mirroring it into the URL means every switch pushes a
	 * navigation on a `[id]` route. Deliberately different from
	 * `back-office/volunteers/+page.svelte`.
	 */
	let activeTab = $state<DetailTab>('overview');

	let editOpen = $state(false);

	const TRIGGER_CLASS =
		'h-auto flex-none gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 pb-2.5 text-xs font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none sm:text-sm';
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button
			variant="outline"
			class="gap-1.5 rounded-xl text-xs sm:text-sm"
			onclick={() => goto(resolve('/back-office/volunteers'))}
		>
			<ArrowLeft class="h-4 w-4" />
			ย้อนกลับไปหน้ากระดานควบคุมงานอาสา (Volunteer Job Board)
		</Button>

		<div class="flex flex-wrap items-center gap-3">
			<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<Building class="h-3.5 w-3.5" />
				ศูนย์พักพิง: {shelterLabel}
			</p>
			<Button
				variant="outline"
				class="gap-1.5 rounded-xl text-xs"
				disabled={!job}
				onclick={() => (editOpen = true)}
			>
				<Pencil class="h-3.5 w-3.5" />
				แก้ไขงานนี้
			</Button>
		</div>
	</div>

	{#if jobQuery.isPending}
		<Skeleton class="h-56 rounded-3xl" />
		<Skeleton class="h-64 rounded-2xl" />
	{:else if jobQuery.isError}
		<p
			class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
		>
			โหลดรายละเอียดงานไม่สำเร็จ: {jobQuery.error instanceof Error
				? jobQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else if !job}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
		>
			<p class="text-sm font-medium">ไม่พบงานอาสาสมัครนี้ในศูนย์ที่เลือก</p>
			<Button variant="outline" size="sm" onclick={() => goto(resolve('/back-office/volunteers'))}>
				กลับไปหน้ากระดานงานอาสา
			</Button>
		</div>
	{:else}
		<JobDetailHero {job} {applicantCount} />

		<Tabs.Root value={activeTab} onValueChange={(v) => (activeTab = v as DetailTab)}>
			<Tabs.List
				class="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0"
			>
				<Tabs.Trigger value="overview" class={TRIGGER_CLASS}>
					<LayoutDashboard class="h-4 w-4 shrink-0" />
					<span class="whitespace-nowrap">1. ภาพรวม (Overview)</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="shifts" class={TRIGGER_CLASS}>
					<CalendarDays class="h-4 w-4 shrink-0" />
					<span class="whitespace-nowrap">2. กะและตารางกะ (Shifts &amp; Schedule)</span>
					<span
						class="grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-[11px] font-bold text-muted-foreground tabular-nums"
					>
						{job.shifts.length}
					</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="applicants" class={TRIGGER_CLASS}>
					<Users class="h-4 w-4 shrink-0" />
					<span class="whitespace-nowrap">3. ผู้สมัคร (Applicants &amp; Queue)</span>
					<span
						class="grid h-5 min-w-5 place-items-center rounded-full bg-primary-dark px-1.5 text-[11px] font-bold text-white tabular-nums"
					>
						{applicantCount}
					</span>
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="overview" class="pt-4">
				<JobDetailOverviewTab {job} />
			</Tabs.Content>

			<Tabs.Content value="shifts" class="pt-4">
				<JobShiftsTab {job} />
			</Tabs.Content>

			<Tabs.Content value="applicants" class="pt-4">
				<div
					class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
				>
					<Construction class="h-8 w-8" />
					<p class="text-sm font-medium">อยู่ระหว่างพัฒนา</p>
					<p class="max-w-md text-xs">
						คิวอนุมัติผู้สมัครและการมอบหมายงาน (Dispatch) ต้องรอหน้าทะเบียนอาสาสมัครก่อน
						จึงจะเปิดใช้งานได้
					</p>
				</div>
			</Tabs.Content>
		</Tabs.Root>

		<JobFormDialog bind:open={editOpen} {job} />
	{/if}
</div>

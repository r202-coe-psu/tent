<script lang="ts">
	/**
	 * `/back-office/volunteers` — shell + 3 tabs (CR-094 FR-VOL-08.1,
	 * 01-tab-job-board.md §01.1). Tab 1 (Job Board & Capacity) and Tab 3
	 * (People — `people-tab.svelte`) are built; Tab 2 (roster/attendance)
	 * still renders a placeholder until its own step lands.
	 *
	 * Tab state lives in the URL (`?tab=jobs|roster|people`) so a refresh
	 * returns to the same tab — mirrors
	 * `back-office/evacuee-management/+page.svelte`.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import {
		VolunteerHubHeader,
		JobBoardTab,
		PeopleTab,
		useHubMetrics
	} from '$lib/features/volunteers';

	type TabKey = 'jobs' | 'roster' | 'people';
	const tabKeys: readonly TabKey[] = ['jobs', 'roster', 'people'];

	const activeTab = $derived.by<TabKey>(() => {
		const requested = page.url.searchParams.get('tab') as TabKey | null;
		return requested && tabKeys.includes(requested) ? requested : 'jobs';
	});

	// Same `useHubMetrics()` query the header reads — the approvals badge must
	// not recompute its own count (CR-094 FR-VOL-08.2 / AC-094-09).
	const hubMetrics = useHubMetrics();
	const pendingApproval = $derived(hubMetrics.data?.pendingApproval ?? 0);

	const tabs = $derived.by(() => [
		{
			key: 'jobs' as const,
			label: 'จัดการงานอาสา (Job Board & Capacity)',
			icon: BriefcaseBusiness
		},
		{ key: 'roster' as const, label: 'ตารางกะและเช็คอิน', icon: CalendarDays },
		{
			key: 'people' as const,
			label: 'รายชื่อและการอนุมัติ',
			icon: UsersRound,
			badge: pendingApproval
		}
	]);

	function selectTab(tab: TabKey) {
		void goto(`${resolve('/back-office/volunteers')}?tab=${tab}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<svelte:head>
	<title>จัดการอาสาสมัคร · SmartShelter</title>
</svelte:head>

<div class="space-y-4 p-4 sm:space-y-5">
	<VolunteerHubHeader />

	<Tabs.Root value={activeTab} onValueChange={(v) => selectTab(v as TabKey)}>
		<!-- Narrow screens stack the three triggers so no Thai label is clipped;
		     from `lg` up they sit inline as one grey rail with a white active pill. -->
		<Tabs.List
			class="grid h-auto w-full grid-cols-1 gap-1 rounded-2xl bg-muted p-1.5 lg:inline-flex lg:w-auto"
		>
			{#each tabs as tab (tab.key)}
				{@const Icon = tab.icon}
				<Tabs.Trigger
					value={tab.key}
					class="h-auto w-full justify-start gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium text-primary-dark/60 data-[state=active]:font-bold data-[state=active]:text-primary-dark lg:w-auto lg:justify-center lg:text-sm"
				>
					<Icon class="h-4 w-4 shrink-0" />
					<span class="truncate">{tab.label}</span>
					{#if tab.badge}
						<span
							class="ml-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-primary-dark tabular-nums"
						>
							{tab.badge}
						</span>
					{/if}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<Tabs.Content value="jobs" class="pt-4">
			<JobBoardTab />
		</Tabs.Content>

		<Tabs.Content value="roster" class="pt-4">
			<div
				class="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
			>
				<p class="text-sm font-medium">อยู่ระหว่างพัฒนา</p>
			</div>
		</Tabs.Content>

		<Tabs.Content value="people" class="pt-4">
			<PeopleTab />
		</Tabs.Content>
	</Tabs.Root>
</div>

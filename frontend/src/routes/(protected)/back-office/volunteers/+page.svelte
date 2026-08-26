<script lang="ts">
	/**
	 * `/back-office/volunteers` — shell + 3 tabs (CR-094 FR-VOL-08.1,
	 * 01-tab-job-board.md §01.1). Only Tab 1 (Job Board & Capacity) is built
	 * here; Tabs 2/3 render a placeholder until their own steps land.
	 *
	 * Tab state lives in the URL (`?tab=jobs|roster|people`) so a refresh
	 * returns to the same tab — mirrors
	 * `back-office/evacuee-management/+page.svelte`.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Users from '@lucide/svelte/icons/users';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { VolunteerHubHeader, JobBoardTab } from '$lib/features/volunteers';

	type TabKey = 'jobs' | 'roster' | 'people';
	const tabKeys: readonly TabKey[] = ['jobs', 'roster', 'people'];

	const activeTab = $derived.by<TabKey>(() => {
		const requested = page.url.searchParams.get('tab') as TabKey | null;
		return requested && tabKeys.includes(requested) ? requested : 'jobs';
	});

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

<div class="space-y-4 p-4">
	<VolunteerHubHeader />

	<Tabs.Root value={activeTab} onValueChange={(v) => selectTab(v as TabKey)}>
		<!-- Narrow screens stack the three triggers into a grid so none is clipped;
		     from `sm` up they sit inline as a normal tab strip. -->
		<Tabs.List class="grid h-auto w-full grid-cols-1 gap-1 sm:inline-flex sm:h-9 sm:w-auto">
			<Tabs.Trigger value="jobs" class="w-full gap-1.5 sm:w-auto">
				<ClipboardList class="h-4 w-4 shrink-0" />
				<span class="truncate">จัดการงานอาสา</span>
			</Tabs.Trigger>
			<Tabs.Trigger value="roster" class="w-full gap-1.5 sm:w-auto">
				<CalendarCheck class="h-4 w-4 shrink-0" />
				<span class="truncate">ตารางกะและเช็คอิน</span>
			</Tabs.Trigger>
			<Tabs.Trigger value="people" class="w-full gap-1.5 sm:w-auto">
				<Users class="h-4 w-4 shrink-0" />
				<span class="truncate">รายชื่อและการอนุมัติ</span>
			</Tabs.Trigger>
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
			<div
				class="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
			>
				<p class="text-sm font-medium">อยู่ระหว่างพัฒนา</p>
			</div>
		</Tabs.Content>
	</Tabs.Root>
</div>

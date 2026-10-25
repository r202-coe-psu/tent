<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Users from '@lucide/svelte/icons/users';
	import Globe from '@lucide/svelte/icons/globe';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	import { useDashboardOccupancy, useDashboardDemographics } from '$lib/features/dashboard';

	import DashboardKpiCards from './dashboard-kpi-cards.svelte';
	import DashboardRegistrationCard from './dashboard-registration-card.svelte';
	import DashboardAgeChart from './dashboard-age-chart.svelte';
	import DashboardNationalityList from './dashboard-nationality-list.svelte';

	let { shelterCode }: { shelterCode: string } = $props();

	// KPIs and demographics — keyed via dashboardKeys so the cache stays consistent with the
	// shelter-list occupancy cell. The registration chart owns its query, range and loading
	// state, so changing its range never blanks these cards (CR-170 FR-6).
	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const demographicsQuery = useDashboardDemographics(() => shelterCode);

	const isLoading = $derived(occupancyQuery.isPending || demographicsQuery.isPending);

	const isError = $derived(occupancyQuery.isError || demographicsQuery.isError);
</script>

<div class="space-y-4 p-4 sm:p-6">
	{#if isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดข้อมูลสถิติได้ กรุณาลองใหม่อีกครั้ง</AlertDescription>
		</Alert>
	{:else if isLoading}
		<Skeleton class="h-40 w-full" />
	{:else if occupancyQuery.data}
		<DashboardKpiCards occupancy={occupancyQuery.data} />
	{/if}

	{#key shelterCode}
		<DashboardRegistrationCard {shelterCode} />
	{/key}

	{#if isLoading}
		<div class="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
			<Skeleton class="h-[300px] w-full" />
			<Skeleton class="h-[300px] w-full" />
		</div>
	{:else if !isError}
		<div class="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
			<!-- Age Range -->
			<div class="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
				<div class="mb-4 flex items-center gap-2">
					<Users class="h-4 w-4 text-primary" />
					<h3 class="leading-none font-semibold tracking-tight">ช่วงอายุผู้เข้าพักทั้งหมด</h3>
				</div>
				{#if demographicsQuery.data}
					<DashboardAgeChart data={demographicsQuery.data.age_groups} />
				{/if}
			</div>

			<!-- Nationality Top 5 -->
			<div
				class="flex min-w-0 flex-col justify-between rounded-xl border bg-card p-4 shadow-sm sm:p-6"
			>
				<div>
					<div class="mb-4 flex items-center gap-2">
						<Globe class="h-4 w-4 text-primary" />
						<h3 class="leading-none font-semibold tracking-tight">ประเทศผู้เข้าพัก</h3>
					</div>
					{#if demographicsQuery.data}
						<DashboardNationalityList data={demographicsQuery.data.countries} />
					{/if}
				</div>
				<div class="mt-6">
					<Dialog.Root>
						<Dialog.Trigger
							class="w-full rounded-md border border-input bg-background py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
						>
							ดูประเทศทั้งหมด
						</Dialog.Trigger>
						<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-[500px]">
							<Dialog.Header>
								<Dialog.Title>ประเทศทั้งหมด</Dialog.Title>
							</Dialog.Header>
							<div class="py-4">
								{#if demographicsQuery.data}
									<DashboardNationalityList
										data={demographicsQuery.data.countries}
										limit={null}
										enableSearch={true}
									/>
								{/if}
							</div>
						</Dialog.Content>
					</Dialog.Root>
				</div>
			</div>
		</div>
	{/if}
</div>

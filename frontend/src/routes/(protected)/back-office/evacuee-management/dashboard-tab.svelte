<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Activity from '@lucide/svelte/icons/activity';
	import Users from '@lucide/svelte/icons/users';
	import Globe from '@lucide/svelte/icons/globe';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	import {
		useDashboardOccupancy,
		useDashboardDemographics,
		useDashboardRegistrations
	} from '$lib/features/dashboard';

	import DashboardKpiCards from './dashboard-kpi-cards.svelte';
	import DashboardRegistrationChart from './dashboard-registration-chart.svelte';
	import DashboardAgeChart from './dashboard-age-chart.svelte';
	import DashboardNationalityList from './dashboard-nationality-list.svelte';

	let { shelterCode }: { shelterCode: string } = $props();

	// KPIs, demographics, and registration trend — keyed via dashboardKeys so the
	// cache stays consistent with the shelter-list occupancy cell.
	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const demographicsQuery = useDashboardDemographics(() => shelterCode);
	const registrationsQuery = useDashboardRegistrations(() => shelterCode); // default range

	const isLoading = $derived(
		occupancyQuery.isPending || demographicsQuery.isPending || registrationsQuery.isPending
	);

	const isError = $derived(
		occupancyQuery.isError || demographicsQuery.isError || registrationsQuery.isError
	);
</script>

<div class="space-y-6 p-6">
	{#if isLoading}
		<div class="space-y-6">
			<Skeleton class="h-32 w-full" />
			<div class="grid gap-6 md:grid-cols-2">
				<Skeleton class="h-[300px] w-full" />
				<Skeleton class="h-[300px] w-full" />
			</div>
		</div>
	{:else if isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดข้อมูลสถิติได้ กรุณาลองใหม่อีกครั้ง</AlertDescription>
		</Alert>
	{:else}
		<!-- KPI Cards -->
		{#if occupancyQuery.data}
			<DashboardKpiCards occupancy={occupancyQuery.data} />
		{/if}

		<div class="flex flex-col gap-6">
			<!-- Registration Trend Chart -->
			<div class="rounded-xl border bg-card p-6 shadow-sm">
				<div class="mb-4 flex items-center gap-2">
					<Activity class="h-4 w-4 text-primary" />
					<h3 class="leading-none font-semibold tracking-tight">สถิติการลงทะเบียน</h3>
				</div>
				{#if registrationsQuery.data}
					<DashboardRegistrationChart data={registrationsQuery.data} />
				{/if}
			</div>

			<div class="grid gap-6 md:grid-cols-2">
				<!-- Age Range -->
				<div class="rounded-xl border bg-card p-6 shadow-sm">
					<div class="mb-4 flex items-center gap-2">
						<Users class="h-4 w-4 text-primary" />
						<h3 class="leading-none font-semibold tracking-tight">ช่วงอายุผู้อพยพทั้งหมด</h3>
					</div>
					{#if demographicsQuery.data}
						<DashboardAgeChart data={demographicsQuery.data.age_groups} />
					{/if}
				</div>

				<!-- Nationality Top 5 -->
				<div class="flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm">
					<div>
						<div class="mb-4 flex items-center gap-2">
							<Globe class="h-4 w-4 text-primary" />
							<h3 class="leading-none font-semibold tracking-tight">ประเทศผู้อพยพ</h3>
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
		</div>
	{/if}
</div>

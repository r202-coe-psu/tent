<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Activity from '@lucide/svelte/icons/activity';
	import Users from '@lucide/svelte/icons/users';
	import Globe from '@lucide/svelte/icons/globe';
	
	import {
		fetchOccupancy,
		fetchDemographics,
		fetchRegistrations
	} from '$lib/features/dashboard';
	
	import DashboardKpiCards from './dashboard-kpi-cards.svelte';
	import DashboardRegistrationChart from './dashboard-registration-chart.svelte';
	import DashboardAgeChart from './dashboard-age-chart.svelte';
	import DashboardNationalityList from './dashboard-nationality-list.svelte';

	let { shelterCode }: { shelterCode: string } = $props();

	// 1. Fetch Occupancy (KPIs)
	const occupancyQuery = createQuery(() => ({
		queryKey: ['dashboard', 'occupancy', shelterCode],
		queryFn: () => fetchOccupancy(shelterCode),
		staleTime: 60 * 1000 // 1 นาที
	}));

	// 2. Fetch Demographics
	const demographicsQuery = createQuery(() => ({
		queryKey: ['dashboard', 'demographics', shelterCode],
		queryFn: () => fetchDemographics(shelterCode),
		staleTime: 60 * 1000
	}));

	// 3. Fetch Registrations
	const registrationsQuery = createQuery(() => ({
		queryKey: ['dashboard', 'registrations', shelterCode],
		queryFn: () => fetchRegistrations(shelterCode), // default range 14 days
		staleTime: 60 * 1000
	}));

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
					<h3 class="font-semibold leading-none tracking-tight">สถิติการลงทะเบียน</h3>
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
						<h3 class="font-semibold leading-none tracking-tight">ช่วงอายุผู้อพยพทั้งหมด (Age Distribution)</h3>
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
							<h3 class="font-semibold leading-none tracking-tight">สัญชาติ / ประเทศ (Nationality)</h3>
						</div>
						{#if demographicsQuery.data}
							<DashboardNationalityList
								data={demographicsQuery.data.countries}
							/>
						{/if}
					</div>
					<div class="mt-6">
						<button class="w-full rounded-md border border-input bg-background py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground">
							ดูสัญชาติทั้งหมด
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

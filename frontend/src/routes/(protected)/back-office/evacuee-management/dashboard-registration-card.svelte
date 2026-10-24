<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { parseDate } from '@internationalized/date';
	import * as Select from '$lib/components/ui/select/index.js';
	import { DateRangePicker } from '$lib/components/ui/date-picker';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import {
		useDashboardRegistrations,
		registrationRangeParams,
		DEFAULT_REGISTRATION_RANGE_PRESET,
		REGISTRATION_RANGE_PRESETS,
		type RegistrationRangePreset
	} from '$lib/features/dashboard';
	import { bangkokToday, formatThaiShortDate } from '$lib/utils/date';
	import DashboardRegistrationChart from './dashboard-registration-chart.svelte';

	// Range state lives here, so the parent's {#key shelterCode} resets it per shelter (CR-170 FR-7).
	let { shelterCode }: { shelterCode: string } = $props();

	const PRESET_LABELS: Record<RegistrationRangePreset, string> = {
		'7d': '7 วันล่าสุด',
		'14d': '14 วันล่าสุด',
		'30d': '30 วันล่าสุด',
		since_open: 'ตั้งแต่เปิดศูนย์',
		custom: 'กำหนดเอง'
	};

	const today = bangkokToday();
	const maxValue = parseDate(today);

	let preset = $state<RegistrationRangePreset>(DEFAULT_REGISTRATION_RANGE_PRESET);
	let customRange = $state<{ from: string; to: string } | undefined>();

	const params = $derived(registrationRangeParams(preset, today, customRange));

	const registrationsQuery = useDashboardRegistrations(
		() => shelterCode,
		() => params.from,
		() => params.to
	);

	function isPreset(value: string): value is RegistrationRangePreset {
		return (REGISTRATION_RANGE_PRESETS as readonly string[]).includes(value);
	}

	function selectPreset(value: string) {
		if (!isPreset(value)) return;
		// Start the custom picker on the range already on screen instead of an empty one.
		if (value === 'custom' && !customRange && registrationsQuery.data) {
			customRange = { ...registrationsQuery.data.range };
		}
		preset = value;
	}
</script>

<div class="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
	<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<div class="flex items-center gap-2">
				<Activity class="h-4 w-4 text-primary" />
				<h3 class="leading-none font-semibold tracking-tight">สถิติการลงทะเบียน</h3>
			</div>
			{#if registrationsQuery.data}
				<p class="text-sm text-muted-foreground tabular-nums">
					{formatThaiShortDate(registrationsQuery.data.range.from)} – {formatThaiShortDate(
						registrationsQuery.data.range.to
					)}
				</p>
			{/if}
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<div class="min-w-0 space-y-1.5">
				<label for="registration-range-preset" class="text-sm font-semibold text-foreground">
					ช่วงวันที่
				</label>
				<Select.Root type="single" bind:value={() => preset, selectPreset}>
					<Select.Trigger
						id="registration-range-preset"
						class="h-11 w-44 min-w-0 rounded-xl bg-background px-3 shadow-xs"
					>
						<span class="truncate">{PRESET_LABELS[preset]}</span>
					</Select.Trigger>
					<Select.Content>
						{#each REGISTRATION_RANGE_PRESETS as option (option)}
							<Select.Item value={option} label={PRESET_LABELS[option]} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			{#if preset === 'custom'}
				<div class="max-w-full min-w-0 space-y-1.5">
					<label for="registration-range-custom" class="text-sm font-semibold text-foreground">
						กำหนดช่วง
					</label>
					<DateRangePicker
						id="registration-range-custom"
						ariaLabel="ช่วงวันที่ของสถิติการลงทะเบียน"
						from={customRange?.from}
						to={customRange?.to}
						{maxValue}
						onRangeChange={(next) => (customRange = next)}
						class="h-11 min-w-0 rounded-xl sm:min-w-[16rem]"
					/>
				</div>
			{/if}
		</div>
	</div>

	{#if registrationsQuery.isPending}
		<Skeleton class="h-72 w-full lg:h-[clamp(14rem,calc(var(--app-shell-height)-32rem),27rem)]" />
	{:else if registrationsQuery.isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดสถิติการลงทะเบียนได้ กรุณาลองใหม่อีกครั้ง</AlertDescription>
		</Alert>
	{:else if registrationsQuery.data}
		<div
			class={['transition-opacity', registrationsQuery.isPlaceholderData && 'opacity-60']}
			aria-busy={registrationsQuery.isPlaceholderData}
		>
			<DashboardRegistrationChart data={registrationsQuery.data} />
		</div>
	{/if}
</div>

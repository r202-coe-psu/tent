<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import HouseholdSearchSelect from '$lib/components/household-search-select.svelte';
	import type { OverviewFilters } from '../domain/schemas';

	let {
		filters,
		onChange,
		showHouseholdFilter = false
	}: {
		filters: OverviewFilters;
		onChange: (next: OverviewFilters) => void;
		showHouseholdFilter?: boolean;
	} = $props();

	function patch(partial: Partial<OverviewFilters>) {
		onChange({ ...filters, ...partial });
	}

	const siteKindValue = $derived(filters.site_kind ?? 'all');
	const operationStatusValue = $derived(filters.operation_status ?? 'all');
	const stayBucketValue = $derived(filters.stay_bucket ?? 'all');
	const sourceValue = $derived(filters.source ?? 'all');
	const householdMode = $derived(filters.shelter_code ? 'shelter' : 'universal');

	const siteKindLabel = $derived.by(() => {
		if (siteKindValue === 'evacuation_center') return 'ศูนย์อพยพ';
		if (siteKindValue === 'host_house') return 'บ้านพี่เลี้ยง';
		return 'ทั้งหมด';
	});

	const operationStatusLabel = $derived.by(() => {
		if (operationStatusValue === 'standby') return 'เตรียมการ';
		if (operationStatusValue === 'active') return 'เปิดรับ';
		if (operationStatusValue === 'full_capacity') return 'เต็มความจุ';
		if (operationStatusValue === 'closed') return 'ปิดศูนย์';
		return 'ทั้งหมด';
	});

	const stayBucketLabel = $derived.by(() => {
		if (stayBucketValue === 'present') return 'อยู่ในศูนย์';
		if (stayBucketValue === 'forecast') return 'คาดการณ์';
		if (stayBucketValue === 'pre_registered') return 'ลงทะเบียนล่วงหน้า';
		if (stayBucketValue === 'checked_out') return 'ออกแล้ว';
		return 'ทั้งหมด';
	});

	const sourceLabel = $derived.by(() => {
		if (sourceValue === 'unassigned') return 'ยังไม่ผูกศูนย์';
		if (sourceValue === 'bound') return 'ผูกศูนย์แล้ว';
		return 'ทั้งหมด';
	});
</script>

<div
	class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
>
	<div class="w-[10.5rem] min-w-0 space-y-1.5">
		<Label for="overview-site-kind" class="text-sm font-semibold text-slate-700">ประเภทศูนย์</Label>
		<Select.Root
			type="single"
			value={siteKindValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({
					site_kind: v === 'all' ? undefined : (v as OverviewFilters['site_kind'])
				});
			}}
		>
			<Select.Trigger
				id="overview-site-kind"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label="ประเภทศูนย์"
				title={`ประเภทศูนย์: ${siteKindLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{siteKindLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="ทั้งหมด" />
				<Select.Item value="evacuation_center" label="ศูนย์อพยพ" />
				<Select.Item value="host_house" label="บ้านพี่เลี้ยง" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="w-[11rem] min-w-0 space-y-1.5">
		<Label for="overview-op-status" class="text-sm font-semibold text-slate-700">สถานะศูนย์</Label>
		<Select.Root
			type="single"
			value={operationStatusValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({
					operation_status: v === 'all' ? undefined : (v as OverviewFilters['operation_status'])
				});
			}}
		>
			<Select.Trigger
				id="overview-op-status"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label="สถานะศูนย์"
				title={`สถานะศูนย์: ${operationStatusLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{operationStatusLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="ทั้งหมด" />
				<Select.Item value="standby" label="เตรียมการ" />
				<Select.Item value="active" label="เปิดรับ" />
				<Select.Item value="full_capacity" label="เต็มความจุ" />
				<Select.Item value="closed" label="ปิดศูนย์" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="w-[9rem] min-w-0 space-y-1.5">
		<Label for="overview-stay" class="text-sm font-semibold text-slate-700">สถานะพัก</Label>
		<Select.Root
			type="single"
			value={stayBucketValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({ stay_bucket: v as OverviewFilters['stay_bucket'] });
			}}
		>
			<Select.Trigger
				id="overview-stay"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label="สถานะพัก"
				title={`สถานะพัก: ${stayBucketLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{stayBucketLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="ทั้งหมด" />
				<Select.Item value="present" label="อยู่ในศูนย์" />
				<Select.Item value="forecast" label="คาดการณ์" />
				<Select.Item value="pre_registered" label="ลงทะเบียนล่วงหน้า" />
				<Select.Item value="checked_out" label="ออกแล้ว" />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="w-[10rem] min-w-0 space-y-1.5">
		<Label for="overview-source" class="text-sm font-semibold text-slate-700">แหล่ง Pre-reg</Label>
		<Select.Root
			type="single"
			value={sourceValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({ source: v as OverviewFilters['source'] });
			}}
		>
			<Select.Trigger
				id="overview-source"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label="แหล่ง Pre-reg"
				title={`แหล่ง Pre-reg: ${sourceLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{sourceLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label="ทั้งหมด" />
				<Select.Item value="unassigned" label="ยังไม่ผูกศูนย์" />
				<Select.Item value="bound" label="ผูกศูนย์แล้ว" />
			</Select.Content>
		</Select.Root>
	</div>

	{#if showHouseholdFilter}
		<div class="w-[14rem] min-w-0 space-y-1.5 sm:w-[16rem]">
			<Label for="overview-household" class="text-sm font-semibold text-slate-700">ครอบครัว</Label>
			<HouseholdSearchSelect
				mode={householdMode}
				shelterCode={filters.shelter_code}
				value={filters.household_id ?? ''}
				onSelect={(item) => patch({ household_id: item?.id || undefined })}
				placeholder="ทุกครอบครัว"
			/>
		</div>
	{/if}

	<div class="min-w-[12rem] flex-1 space-y-1.5">
		<Label for="overview-q" class="text-sm font-semibold text-slate-700">ค้นหา</Label>
		<Input
			id="overview-q"
			type="search"
			placeholder="ชื่อ / เบอร์โทร..."
			class="h-9"
			value={filters.q ?? ''}
			oninput={(e) => {
				const q = e.currentTarget.value.trim();
				patch({ q: q || undefined });
			}}
		/>
	</div>
</div>

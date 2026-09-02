<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import Search from '@lucide/svelte/icons/search';
	import {
		approvalCoverageOptions,
		distributionRequestStatusOptions,
		type RequestCoverageFilter,
		type RequestStatusFilter
	} from './request-ui';

	let {
		search = $bindable(''),
		status = $bindable<RequestStatusFilter>('all'),
		coverage = $bindable<RequestCoverageFilter>('all')
	}: {
		search?: string;
		status?: RequestStatusFilter;
		coverage?: RequestCoverageFilter;
	} = $props();
</script>

<div class="grid gap-3 border-b border-border/70 pb-4 sm:grid-cols-[minmax(0,1fr)_13rem_13rem]">
	<div class="relative">
		<Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
		<Input
			bind:value={search}
			type="search"
			placeholder="ค้นหารหัสคำร้อง วัตถุประสงค์ หรือผู้ขอ"
			class="pl-9"
			aria-label="ค้นหาคำร้องเบิกจ่าย"
		/>
	</div>
	<label class="grid gap-1 text-sm font-medium text-muted-foreground">
		<span class="sr-only">สถานะคำร้อง</span>
		<select
			bind:value={status}
			class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-label="กรองตามสถานะคำร้อง"
		>
			{#each distributionRequestStatusOptions as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
	<label class="grid gap-1 text-sm font-medium text-muted-foreground">
		<span class="sr-only">ผลการจัดสรร</span>
		<select
			bind:value={coverage}
			class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-label="กรองตามผลการจัดสรร"
		>
			{#each approvalCoverageOptions as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</label>
</div>

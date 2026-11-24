<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { useAuditLog } from '../application/queries';
	import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../domain/audit-event';
	import {
		auditFilterFormFromParams,
		auditFilterFormToParams,
		auditFiltersFromForm,
		EMPTY_AUDIT_FILTER_FORM,
		type AuditFilterForm
	} from '../domain/audit-filters';
	import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '../domain/labels';
	import AuditEventList from './audit-event-list.svelte';

	let { isSystemAdmin, shelterCode }: { isSystemAdmin: boolean; shelterCode: string | null } =
		$props();

	const applied = $derived(auditFilterFormFromParams(page.url.searchParams));
	let entityType = $derived(applied.entity_type);
	let action = $derived(applied.action);
	let actor = $derived(applied.actor);
	let fromDate = $derived(applied.from_date);
	let toDate = $derived(applied.to_date);
	let shelterFilter = $derived(applied.shelter_code);

	const filters = $derived(auditFiltersFromForm(applied, isSystemAdmin ? null : shelterCode));
	const query = useAuditLog(
		() => filters,
		() => isSystemAdmin || Boolean(shelterCode)
	);
	const items = $derived(query.data?.pages.flatMap((p) => p.items) ?? []);

	$effect(() => {
		if (query.isError) toast.error(query.error?.message || 'โหลดบันทึกการใช้งานไม่สำเร็จ');
	});

	function navigate(next: AuditFilterForm) {
		const qs = auditFilterFormToParams(next).toString();
		if (qs === page.url.searchParams.toString()) return;
		void goto(
			resolve(
				`/back-office/audit-log${qs ? `?${qs}` : ''}` as
					'/back-office/audit-log' | `/back-office/audit-log?${string}`
			),
			{ replaceState: true, keepFocus: true, noScroll: true }
		);
	}

	function clearFilters() {
		entityType = '';
		action = '';
		actor = '';
		fromDate = '';
		toDate = '';
		shelterFilter = '';
		navigate({ ...EMPTY_AUDIT_FILTER_FORM });
	}

	function apply(event: SubmitEvent) {
		event.preventDefault();
		navigate({
			entity_type: entityType,
			action,
			actor,
			from_date: fromDate,
			to_date: toDate,
			shelter_code: shelterFilter
		});
	}

	const entityOptions = AUDIT_ENTITY_TYPES.map((value) => ({
		value,
		label: AUDIT_ENTITY_LABELS[value]
	}));
	const actionOptions = AUDIT_ACTIONS.map((value) => ({
		value,
		label: AUDIT_ACTION_LABELS[value]
	}));
</script>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
	<header class="space-y-1 border-b border-border/60 pb-5">
		<h1 class="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
			บันทึกการใช้งาน (Audit Log)
		</h1>
		<p class="text-sm text-slate-500">
			{isSystemAdmin
				? 'ประวัติการสร้าง แก้ไข และลบข้อมูลของทุกศูนย์'
				: `ประวัติการสร้าง แก้ไข และลบข้อมูลของศูนย์ ${shelterCode ?? ''}`}
		</p>
	</header>

	<form
		class="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:grid-cols-2 lg:grid-cols-3"
		onsubmit={apply}
	>
		<div class="space-y-1.5">
			<Label for="audit-entity-type" class="text-sm font-semibold text-slate-700"
				>ประเภทข้อมูล</Label
			>
			<Select.Root type="single" bind:value={entityType}>
				<Select.Trigger id="audit-entity-type" class="h-11 w-full sm:h-10">
					{entityOptions.find((o) => o.value === entityType)?.label ?? 'ทั้งหมด'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="ทั้งหมด" />
					{#each entityOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-1.5">
			<Label for="audit-action" class="text-sm font-semibold text-slate-700">การกระทำ</Label>
			<Select.Root type="single" bind:value={action}>
				<Select.Trigger id="audit-action" class="h-11 w-full sm:h-10">
					{actionOptions.find((o) => o.value === action)?.label ?? 'ทั้งหมด'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="ทั้งหมด" />
					{#each actionOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-1.5">
			<Label for="audit-actor" class="text-sm font-semibold text-slate-700">ผู้ทำ (username)</Label>
			<Input
				id="audit-actor"
				bind:value={actor}
				placeholder="เช่น somchai.k"
				class="h-11 sm:h-10"
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="audit-from" class="text-sm font-semibold text-slate-700">ตั้งแต่วันที่</Label>
			<Input id="audit-from" type="date" bind:value={fromDate} class="h-11 sm:h-10" />
		</div>
		<div class="space-y-1.5">
			<Label for="audit-to" class="text-sm font-semibold text-slate-700">ถึงวันที่</Label>
			<Input id="audit-to" type="date" bind:value={toDate} class="h-11 sm:h-10" />
		</div>
		{#if isSystemAdmin}
			<div class="space-y-1.5">
				<Label for="audit-shelter" class="text-sm font-semibold text-slate-700">รหัสศูนย์</Label>
				<Input
					id="audit-shelter"
					bind:value={shelterFilter}
					placeholder="เช่น SH001 (เว้นว่าง = ทุกศูนย์)"
					class="h-11 sm:h-10"
				/>
			</div>
		{/if}
		<div class="flex flex-col gap-2 sm:col-span-2 sm:flex-row lg:col-span-3">
			<Button type="submit" class="min-h-11 w-full sm:w-auto">ค้นหา</Button>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 w-full sm:w-auto"
				onclick={clearFilters}
			>
				ล้างตัวกรอง
			</Button>
		</div>
	</form>

	<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
		{#if query.isLoading}
			<p class="text-sm text-slate-500" role="status">กำลังโหลด...</p>
		{:else if items.length === 0 && !query.hasNextPage}
			<p class="text-sm text-slate-500">ไม่พบรายการ</p>
		{:else}
			{#if items.length === 0}
				<p class="text-sm text-slate-500">
					ยังไม่พบรายการในช่วงที่ค้นไปแล้ว — กดโหลดเพิ่มเพื่อค้นต่อ
				</p>
			{:else}
				<AuditEventList {items} showShelter={isSystemAdmin} />
			{/if}
			{#if query.hasNextPage}
				<div class="pt-3">
					<Button
						type="button"
						variant="outline"
						class="min-h-11 w-full sm:w-auto"
						disabled={query.isFetchingNextPage}
						onclick={() => query.fetchNextPage()}
					>
						{query.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
					</Button>
				</div>
			{/if}
		{/if}
	</section>
</div>

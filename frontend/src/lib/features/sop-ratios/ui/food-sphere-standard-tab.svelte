<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import {
		targetSegmentSchema,
		TARGET_SEGMENT_LABELS,
		type FoodSphereStandard
	} from '../domain/food-sphere';
	import { SOURCE_LABELS } from '$lib/utils/source';
	import {
		useFoodSphereStandards,
		useDeleteFoodSphereOverride,
		useSetFoodSphereStandardStatus
	} from '../application/food-sphere-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import FoodSphereStandardForm from './food-sphere-standard-form.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	// Icons
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Loader from '@lucide/svelte/icons/loader';

	let {
		shelterCode = '',
		isSA = false,
		canEditOverride = false
	}: {
		shelterCode?: string;
		isSA?: boolean;
		canEditOverride?: boolean;
	} = $props();

	const standardsQuery = useFoodSphereStandards(() => shelterCode);
	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const deleteMutation = useDeleteFoodSphereOverride();
	const setStatusMutation = useSetFoodSphereStandardStatus();

	let search = $state('');
	let filterSegment = $state<string>('ALL_SEGMENTS');
	let filterGroup = $state<string>('ALL_GROUPS');
	let filterStatus = $state<'ALL' | 'active' | 'inactive'>('ALL');

	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedStandard = $state<FoodSphereStandard | null>(null);
	let standardToDelete = $state<FoodSphereStandard | null>(null);
	let isDeleteDialogOpen = $state(false);

	const standards = $derived(standardsQuery.data ?? []);
	const reqGroups = $derived(reqGroupsQuery.data ?? []);

	// Lookup map for standard UOM from requirement groups
	const uomMap = $derived(
		new Map(reqGroups.map((g) => [g._id.replace(/^requirement_group:/, ''), g.standard_uom]))
	);

	const filteredStandards = $derived(
		standards.filter((s) => {
			const status = s.status ?? 'active';
			if (filterStatus !== 'ALL' && status !== filterStatus) {
				return false;
			}
			if (filterSegment !== 'ALL_SEGMENTS' && s.target_segment !== filterSegment) {
				return false;
			}
			if (filterGroup !== 'ALL_GROUPS' && s.req_group_id !== filterGroup) {
				return false;
			}
			if (search.trim()) {
				const query = search.toLowerCase();
				return (
					s.target_segment.toLowerCase().includes(query) ||
					s.req_group_id.toLowerCase().includes(query) ||
					(TARGET_SEGMENT_LABELS[s.target_segment] ?? '').toLowerCase().includes(query)
				);
			}
			return true;
		})
	);

	function showCreateForm() {
		selectedStandard = null;
		viewMode = 'create';
	}

	function showEditForm(std: FoodSphereStandard) {
		selectedStandard = std;
		viewMode = 'edit';
	}

	function backToList() {
		viewMode = 'list';
		selectedStandard = null;
	}

	function openDeleteDialog(std: FoodSphereStandard) {
		standardToDelete = std;
		isDeleteDialogOpen = true;
	}

	async function handleConfirmDelete() {
		if (!standardToDelete) return;
		try {
			await deleteMutation.mutateAsync({
				id: standardToDelete._id,
				shelterCode: standardToDelete.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			isDeleteDialogOpen = false;
			standardToDelete = null;
		} catch (err) {
			console.error('Failed to deactivate food sphere standard:', err);
		}
	}

	async function handleReactivate(std: FoodSphereStandard) {
		try {
			await setStatusMutation.mutateAsync({
				id: std._id,
				status: 'active',
				shelterCode: std.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
		} catch (err) {
			console.error('Failed to activate food sphere standard:', err);
		}
	}
</script>

{#snippet statusBadge(active: boolean)}
	{#if active}
		<span
			class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-emerald-800"
		>
			ใช้งาน
		</span>
	{:else}
		<span
			class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-slate-600"
		>
			ปิดใช้งาน
		</span>
	{/if}
{/snippet}

{#snippet sourceBadge(source: string | undefined)}
	{#if source === 'SHELTER_OVERRIDE'}
		<span
			class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-amber-800"
		>
			{SOURCE_LABELS.SHELTER_OVERRIDE}
		</span>
	{:else}
		<span
			class="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-800"
		>
			{SOURCE_LABELS.SPHERE_BASELINE}
		</span>
	{/if}
{/snippet}

{#if viewMode === 'list'}
	<section class="min-w-0">
		<div class="space-y-4">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 class="text-lg font-bold text-slate-900 sm:text-xl">เกณฑ์มาตรฐานโภชนาการ</h2>
					<p class="text-sm text-slate-600">จัดการพารามิเตอร์เกณฑ์โภชนาการตามกลุ่มเป้าหมาย</p>
				</div>
				{#if isSA || canEditOverride}
					<Button
						type="button"
						onclick={showCreateForm}
						class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						เพิ่มเกณฑ์โภชนาการ
					</Button>
				{/if}
			</div>

			<div
				class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
			>
				<div
					class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] md:p-4"
				>
					<div class="relative col-span-2 md:col-span-1">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
							aria-hidden="true"
						/>
						<Input
							bind:value={search}
							type="search"
							placeholder="ค้นหาเกณฑ์"
							class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
							aria-label="ค้นหาเกณฑ์"
						/>
					</div>
					<select
						id="filter-segment"
						bind:value={filterSegment}
						aria-label="กรองกลุ่มเป้าหมาย"
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL_SEGMENTS">กลุ่มเป้าหมาย: ทั้งหมด</option>
						{#each targetSegmentSchema.options as seg (seg)}
							<option value={seg}>กลุ่มเป้าหมาย: {TARGET_SEGMENT_LABELS[seg] ?? seg}</option>
						{/each}
					</select>
					<select
						id="filter-group"
						bind:value={filterGroup}
						aria-label="กรองกลุ่มสารอาหาร"
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL_GROUPS">กลุ่มสารอาหาร: ทั้งหมด</option>
						{#each reqGroups as g (g)}
							{@const cleanId = g._id.replace(/^requirement_group:/, '')}
							<option value={cleanId}>กลุ่มสารอาหาร: {g.name} ({cleanId})</option>
						{/each}
					</select>
					<select
						id="filter-status"
						bind:value={filterStatus}
						aria-label="กรองสถานะ"
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL">สถานะ: ทั้งหมด</option>
						<option value="active">สถานะ: ใช้งานอยู่</option>
						<option value="inactive">สถานะ: ปิดใช้งาน</option>
					</select>
				</div>

				<p class="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600">
					กำลังแสดง <strong class="font-semibold text-slate-900 tabular-nums"
						>{filteredStandards.length}</strong
					>
					จาก {standards.length} รายการ
				</p>

				{#if standardsQuery.isLoading}
					<div class="flex-1 space-y-3 p-4" role="status" aria-label="กำลังโหลด">
						{#each [0, 1, 2, 3] as i (i)}
							<div
								class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"
							></div>
						{/each}
					</div>
				{:else if filteredStandards.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center gap-1 p-12 text-center">
						<p class="text-sm font-medium text-slate-500">ไม่พบรายการเกณฑ์โภชนาการตามเงื่อนไข</p>
						{#if isSA || canEditOverride}
							<p class="text-sm text-slate-500">
								กดปุ่ม "เพิ่มเกณฑ์โภชนาการ" เพื่อเริ่มต้นกำหนดค่า
							</p>
						{/if}
					</div>
				{:else}
					<div class="flex-1 overflow-x-auto">
						<table class="w-full min-w-[900px] text-left text-sm">
							<thead
								class="border-b border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th class="p-3.5 pl-4 whitespace-nowrap">กลุ่มเป้าหมาย</th>
									<th class="p-3.5 whitespace-nowrap">กลุ่มความต้องการ</th>
									<th class="p-3.5 text-right whitespace-nowrap">ปริมาณต่อคนต่อวัน</th>
									<th class="p-3.5 whitespace-nowrap">หน่วยนับ</th>
									<th class="p-3.5 whitespace-nowrap">วันบังคับใช้</th>
									<th class="p-3.5 whitespace-nowrap">สถานะ</th>
									<th class="p-3.5 whitespace-nowrap">แหล่งที่มา</th>
									<th class="p-3.5 pr-4 text-right whitespace-nowrap"
										><span class="sr-only">การจัดการ</span></th
									>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each filteredStandards as std (std._id)}
									{@const uom = uomMap.get(std.req_group_id) ?? std.standard_uom ?? '—'}
									<tr class="transition-colors hover:bg-slate-50">
										<td class="p-3.5 pl-4 font-bold whitespace-nowrap text-slate-900">
											{TARGET_SEGMENT_LABELS[std.target_segment] ?? std.target_segment}
										</td>
										<td
											class="p-3.5 font-mono text-xs font-semibold whitespace-nowrap text-slate-900"
											>{std.req_group_id}</td
										>
										<td
											class="p-3.5 text-right font-mono font-bold whitespace-nowrap text-slate-900"
										>
											{std.daily_demand.toLocaleString()}
										</td>
										<td class="p-3.5 font-mono text-xs whitespace-nowrap text-slate-600">{uom}</td>
										<td class="p-3.5 text-xs whitespace-nowrap text-slate-600 tabular-nums"
											>{std.effective_date}</td
										>
										<td class="p-3.5"
											>{@render statusBadge((std.status ?? 'active') === 'active')}</td
										>
										<td class="p-3.5">{@render sourceBadge(std.source)}</td>
										<td class="p-3.5 pr-4 text-right">
											<div class="flex items-center justify-end gap-2">
												{#if isSA || canEditOverride}
													<Button
														variant="outline"
														aria-label={`แก้ไข ${std.req_group_id}`}
														onclick={() => showEditForm(std)}
														class="min-h-11 gap-1.5 rounded-lg border-slate-300 text-sm font-semibold whitespace-nowrap"
													>
														<Settings2 class="h-3.5 w-3.5" aria-hidden="true" />
														แก้ไข
													</Button>
													{#if isSA || std.source === 'SHELTER_OVERRIDE'}
														{#if (std.status ?? 'active') === 'active'}
															<Button
																variant="destructive"
																aria-label={`ปิดใช้งาน ${std.req_group_id}`}
																onclick={() => openDeleteDialog(std)}
																class="min-h-11 gap-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
															>
																<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
																ปิดใช้งาน
															</Button>
														{:else}
															<Button
																variant="outline"
																disabled={setStatusMutation.isPending}
																aria-label={`เปิดใช้งาน ${std.req_group_id}`}
																onclick={() => handleReactivate(std)}
																class="min-h-11 gap-1.5 rounded-lg border-slate-300 text-sm font-semibold whitespace-nowrap text-emerald-700 hover:text-emerald-800"
															>
																<RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
																เปิดใช้งาน
															</Button>
														{/if}
													{/if}
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	</section>
{:else}
	<div
		class="w-full min-w-0 rounded-2xl border border-slate-100 bg-card p-6 shadow-sm md:p-8 dark:border-zinc-800"
	>
		<div class="flex items-start justify-between gap-4">
			<div class="flex flex-col gap-1.5">
				<h1
					class="flex items-center gap-2 text-xl leading-tight font-bold text-slate-800 md:text-2xl dark:text-slate-100"
				>
					{#if viewMode === 'edit'}
						<span>แก้ไขพารามิเตอร์อ้างอิงสำหรับอาหาร</span>
					{:else}
						<span>บันทึกพารามิเตอร์อ้างอิงสำหรับอาหารใหม่</span>
					{/if}
				</h1>
			</div>

			<div class="flex items-center">
				<button
					type="button"
					onclick={backToList}
					class="rounded-lg p-2 transition hover:bg-muted/50"
					aria-label="ปิดฟอร์ม"
				>
					<X class="h-5 w-5 text-muted-foreground" />
				</button>
			</div>
		</div>

		<Separator class="my-4 bg-slate-100 dark:bg-zinc-800" />

		{#if isSA || canEditOverride}
			<FoodSphereStandardForm
				standard={selectedStandard}
				isEdit={viewMode === 'edit'}
				{shelterCode}
				onsuccess={backToList}
				oncancel={backToList}
			/>
		{:else}
			<div class="py-12 text-center text-sm font-bold text-destructive">
				คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (Unauthorized)
			</div>
		{/if}
	</div>
{/if}

<AlertDialog.Root bind:open={isDeleteDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการปิดใช้งานเกณฑ์มาตรฐานโภชนาการ</AlertDialog.Title>
			<AlertDialog.Description>
				{#if standardToDelete}
					คุณต้องการปิดการใช้งานเกณฑ์โภชนาการสำหรับ <span class="font-semibold text-foreground"
						>{TARGET_SEGMENT_LABELS[standardToDelete.target_segment] ??
							standardToDelete.target_segment}</span
					>
					— <span class="font-semibold text-foreground">{standardToDelete.req_group_id}</span>
					ใช่หรือไม่?
					<br /><br />
					<span class="text-xs text-muted-foreground">
						การปิดใช้งานจะทำให้เกณฑ์นี้ไม่ถูกนำไปคำนวณความต้องการประจำวัน (Daily Demand)
						แต่ข้อมูลเดิมจะยังคงอยู่และสามารถเปิดใช้งานกลับมาได้ตลอดเวลา
					</span>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				disabled={deleteMutation.isPending}
				onclick={() => {
					standardToDelete = null;
				}}
			>
				ยกเลิก
			</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				disabled={deleteMutation.isPending}
				onclick={(e) => {
					e.preventDefault();
					handleConfirmDelete();
				}}
			>
				{#if deleteMutation.isPending}
					<Loader class="mr-2 h-4 w-4 animate-spin" />
					กำลังปิดใช้งาน...
				{:else}
					ยืนยันปิดใช้งาน
				{/if}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

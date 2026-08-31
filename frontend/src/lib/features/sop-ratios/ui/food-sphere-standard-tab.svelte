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

{#if viewMode === 'list'}
	<section class="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
		<header class="mb-6 flex flex-col gap-4">
			<div class="flex w-full flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
				<div>
					<h1 class="text-xl font-semibold">เกณฑ์มาตรฐานโภชนาการ</h1>
					<p class="text-sm text-muted-foreground">
						จัดการพารามิเตอร์เกณฑ์โภชนาการตามกลุ่มเป้าหมาย
					</p>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<div class="relative w-full sm:w-56">
						<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							bind:value={search}
							type="search"
							placeholder="ค้นหาเกณฑ์..."
							class="pl-9"
							aria-label="ค้นหาเกณฑ์"
						/>
					</div>

					{#if isSA || canEditOverride}
						<Button onclick={showCreateForm} class="ml-auto flex shrink-0 items-center gap-1.5">
							<Plus class="h-4 w-4" />
							เพิ่มเกณฑ์โภชนาการ
						</Button>
					{/if}
				</div>
			</div>

			<!-- Filters bar -->
			<div class="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
				<div class="flex items-center gap-1.5">
					<label for="filter-segment" class="font-medium text-muted-foreground"
						>กลุ่มเป้าหมาย:</label
					>
					<select
						id="filter-segment"
						bind:value={filterSegment}
						class="rounded-md border bg-background px-2.5 py-1 text-xs"
					>
						<option value="ALL_SEGMENTS">ทั้งหมด (ทุกกลุ่มเป้าหมาย)</option>
						{#each targetSegmentSchema.options as seg (seg)}
							<option value={seg}>{TARGET_SEGMENT_LABELS[seg] ?? seg}</option>
						{/each}
					</select>
				</div>

				<div class="flex items-center gap-1.5">
					<label for="filter-group" class="font-medium text-muted-foreground">กลุ่มสารอาหาร:</label>
					<select
						id="filter-group"
						bind:value={filterGroup}
						class="rounded-md border bg-background px-2.5 py-1 text-xs"
					>
						<option value="ALL_GROUPS">ทั้งหมด (ทุกกลุ่ม)</option>
						{#each reqGroups as g (g)}
							{@const cleanId = g._id.replace(/^requirement_group:/, '')}
							<option value={cleanId}>{g.name} ({cleanId})</option>
						{/each}
					</select>
				</div>

				<div class="flex items-center gap-1.5">
					<label for="filter-status" class="font-medium text-muted-foreground">สถานะ:</label>
					<select
						id="filter-status"
						bind:value={filterStatus}
						class="rounded-md border bg-background px-2.5 py-1 text-xs"
					>
						<option value="ALL">ทุกสถานะ</option>
						<option value="active">ใช้งานอยู่</option>
						<option value="inactive">ปิดใช้งาน</option>
					</select>
				</div>

				<div class="ml-auto text-xs text-muted-foreground">
					แสดง {filteredStandards.length} จาก {standards.length} รายการ
				</div>
			</div>
		</header>

		{#if standardsQuery.isLoading}
			<div class="flex min-h-[300px] items-center justify-center">
				<div
					class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
				></div>
			</div>
		{:else if filteredStandards.length === 0}
			<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
				<p class="font-medium">ไม่พบรายการเกณฑ์โภชนาการตามเงื่อนไข</p>
				{#if isSA || canEditOverride}
					<p class="mt-1 text-sm">คลิกปุ่ม "เพิ่มเกณฑ์โภชนาการ" เพื่อเริ่มต้นกำหนดค่า</p>
				{/if}
			</div>
		{:else}
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-left text-sm">
					<thead class="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase">
						<tr>
							<th class="p-3">กลุ่มเป้าหมาย</th>
							<th class="p-3">กลุ่มความต้องการ</th>
							<th class="p-3 text-right">ปริมาณต่อคนต่อวัน</th>
							<th class="p-3">หน่วยนับ</th>
							<th class="p-3">วันบังคับใช้</th>
							<th class="p-3">สถานะ</th>
							<th class="p-3">แหล่งที่มา</th>
							<th class="p-3 text-right">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each filteredStandards as std (std._id)}
							{@const uom = uomMap.get(std.req_group_id) ?? std.standard_uom ?? '—'}
							<tr class="hover:bg-muted/30">
								<td class="p-3 font-medium text-foreground">
									{TARGET_SEGMENT_LABELS[std.target_segment] ?? std.target_segment}
								</td>
								<td class="p-3 font-mono font-medium">{std.req_group_id}</td>
								<td class="p-3 text-right font-mono font-semibold text-foreground">
									{std.daily_demand.toLocaleString()}
								</td>
								<td class="p-3 font-mono text-xs">{uom}</td>
								<td class="p-3 text-xs text-muted-foreground">{std.effective_date}</td>
								<td class="p-3">
									{#if (std.status ?? 'active') === 'active'}
										<span
											class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
										>
											ใช้งาน
										</span>
									{:else}
										<span
											class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"
										>
											ปิดใช้งาน
										</span>
									{/if}
								</td>
								<td class="p-3">
									{#if std.source === 'SHELTER_OVERRIDE'}
										<span
											class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
										>
											{SOURCE_LABELS.SHELTER_OVERRIDE}
										</span>
									{:else}
										<span
											class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
										>
											{SOURCE_LABELS.SPHERE_BASELINE}
										</span>
									{/if}
								</td>
								<td class="p-3 text-right">
									<div class="flex items-center justify-end gap-2">
										{#if isSA || (canEditOverride && std.source === 'SHELTER_OVERRIDE')}
											<Button
												variant="outline"
												size="sm"
												aria-label={`แก้ไข ${std.req_group_id}`}
												onclick={() => showEditForm(std)}
											>
												<Settings2 class="h-3.5 w-3.5" />
												แก้ไข
											</Button>
											{#if (std.status ?? 'active') === 'active'}
												<Button
													variant="destructive"
													size="sm"
													aria-label={`ปิดใช้งาน ${std.req_group_id}`}
													onclick={() => openDeleteDialog(std)}
												>
													<Trash2 class="h-3.5 w-3.5" />
													ปิดใช้งาน
												</Button>
											{:else}
												<Button
													variant="outline"
													size="sm"
													disabled={setStatusMutation.isPending}
													aria-label={`เปิดใช้งาน ${std.req_group_id}`}
													onclick={() => handleReactivate(std)}
													class="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
												>
													<RotateCcw class="h-3.5 w-3.5" />
													เปิดใช้งาน
												</Button>
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

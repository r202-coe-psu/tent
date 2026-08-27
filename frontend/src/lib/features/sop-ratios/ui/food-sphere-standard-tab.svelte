<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		targetSegmentSchema,
		TARGET_SEGMENT_LABELS,
		type FoodSphereStandard
	} from '../domain/food-sphere';
	import {
		useFoodSphereStandards,
		useDeleteFoodSphereOverride
	} from '../application/food-sphere-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import FoodSphereStandardModal from './food-sphere-standard-modal.svelte';

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

	let search = $state('');
	let filterSegment = $state<string>('ALL_SEGMENTS');
	let filterGroup = $state<string>('ALL_GROUPS');

	let isModalOpen = $state(false);
	let selectedStandard = $state<FoodSphereStandard | null>(null);

	const standards = $derived(standardsQuery.data ?? []);
	const reqGroups = $derived(reqGroupsQuery.data ?? []);

	// Lookup map for standard UOM from requirement groups
	const uomMap = $derived(
		new Map(reqGroups.map((g) => [g._id.replace(/^requirement_group:/, ''), g.standard_uom]))
	);

	const filteredStandards = $derived(
		standards.filter((s) => {
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

	function openCreateModal() {
		selectedStandard = null;
		isModalOpen = true;
	}

	function openEditModal(std: FoodSphereStandard) {
		selectedStandard = std;
		isModalOpen = true;
	}

	async function handleDelete(std: FoodSphereStandard) {
		if (
			!confirm(
				`คุณต้องการลบเกณฑ์โภชนาการสำหรับ ${std.target_segment} - ${std.req_group_id} หรือไม่?`
			)
		) {
			return;
		}
		await deleteMutation.mutateAsync({
			id: std._id,
			shelterCode: std.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
	}
</script>

<section class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
	<header class="mb-6 flex flex-col gap-4">
		<div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<div>
				<h1 class="text-xl font-semibold">เกณฑ์มาตรฐานโภชนาการ (Food Sphere Standard)</h1>
				<p class="text-sm text-muted-foreground">
					จัดการพารามิเตอร์เกณฑ์โภชนาการตามกลุ่มเป้าหมาย (Sphere Project Handbook)
				</p>
			</div>

			<div class="flex items-center gap-2">
				<div class="relative w-full sm:w-56">
					<Input
						bind:value={search}
						type="search"
						placeholder="ค้นหาเกณฑ์..."
						class="pl-9"
						aria-label="ค้นหาเกณฑ์"
					/>
					<svg
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.3-4.3" />
					</svg>
				</div>

				{#if isSA || canEditOverride}
					<Button onclick={openCreateModal} class="shrink-0">เพิ่มเกณฑ์โภชนาการ</Button>
				{/if}
			</div>
		</div>

		<!-- Filters bar -->
		<div class="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
			<div class="flex items-center gap-1.5">
				<label for="filter-segment" class="font-medium text-muted-foreground">Segment:</label>
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
						<th class="p-3">กลุ่มเป้าหมาย (Segment)</th>
						<th class="p-3">กลุ่มความต้องการ (Group)</th>
						<th class="p-3 text-right">ปริมาณต่อคนต่อวัน</th>
						<th class="p-3">หน่วยนับ</th>
						<th class="p-3">วันบังคับใช้</th>
						<th class="p-3">แหล่งที่มา</th>
						<th class="p-3 text-right">การจัดการ</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each filteredStandards as std (std._id)}
						{@const uom = uomMap.get(std.req_group_id) ?? std.standard_uom ?? '—'}
						<tr class="hover:bg-muted/30">
							<td class="p-3 font-medium">
								<div>{TARGET_SEGMENT_LABELS[std.target_segment] ?? std.target_segment}</div>
								<div class="font-mono text-xs text-muted-foreground">{std.target_segment}</div>
							</td>
							<td class="p-3 font-mono font-medium">{std.req_group_id}</td>
							<td class="p-3 text-right font-mono font-semibold text-foreground">
								{std.daily_demand.toLocaleString()}
							</td>
							<td class="p-3 font-mono text-xs">{uom}</td>
							<td class="p-3 text-xs text-muted-foreground">{std.effective_date}</td>
							<td class="p-3">
								{#if std.source === 'SHELTER_OVERRIDE'}
									<span
										class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
									>
										ศูนย์พักพิง {std.shelter_code ?? ''}
									</span>
								{:else}
									<span
										class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
									>
										ส่วนกลาง (Sphere Baseline)
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
											onclick={() => openEditModal(std)}
										>
											แก้ไข
										</Button>
										<Button
											variant="destructive"
											size="sm"
											aria-label={`ลบ ${std.req_group_id}`}
											onclick={() => handleDelete(std)}
										>
											ลบ
										</Button>
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

<FoodSphereStandardModal
	bind:open={isModalOpen}
	standard={selectedStandard}
	{shelterCode}
	{isSA}
	onClose={() => {
		selectedStandard = null;
	}}
/>

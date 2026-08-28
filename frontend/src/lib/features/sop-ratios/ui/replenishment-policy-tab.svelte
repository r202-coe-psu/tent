<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { type ReplenishmentPolicy } from '../domain/replenishment-policy';
	import { SOURCE_LABELS } from '$lib/utils/source';
	import { calculateStandardReorderDays } from '../domain/replenishment-calc';
	import {
		useReplenishmentPolicies,
		useDeleteReplenishmentOverride
	} from '../application/replenishment-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import ReplenishmentPolicyModal from './replenishment-policy-modal.svelte';

	let {
		shelterCode = '',
		isSA = false,
		canEditOverride = false
	}: {
		shelterCode?: string;
		isSA?: boolean;
		canEditOverride?: boolean;
	} = $props();

	const policiesQuery = useReplenishmentPolicies(() => shelterCode);
	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const deleteMutation = useDeleteReplenishmentOverride();

	let search = $state('');
	let filterGroup = $state<string>('ALL_GROUPS');

	let isModalOpen = $state(false);
	let selectedPolicy = $state<ReplenishmentPolicy | null>(null);

	const policies = $derived(policiesQuery.data ?? []);
	const reqGroups = $derived(reqGroupsQuery.data ?? []);
	const groupMap = $derived(
		new Map(reqGroups.map((g) => [g._id.replace(/^requirement_group:/, ''), g.name]))
	);

	const filteredPolicies = $derived(
		policies.filter((p) => {
			if (filterGroup !== 'ALL_GROUPS' && p.target_id !== filterGroup) {
				return false;
			}
			if (search.trim()) {
				const query = search.toLowerCase();
				const groupName = groupMap.get(p.target_id) ?? '';
				return p.target_id.toLowerCase().includes(query) || groupName.toLowerCase().includes(query);
			}
			return true;
		})
	);

	function openCreateModal() {
		selectedPolicy = null;
		isModalOpen = true;
	}

	function openEditModal(pol: ReplenishmentPolicy) {
		selectedPolicy = pol;
		isModalOpen = true;
	}

	async function handleDelete(pol: ReplenishmentPolicy) {
		const groupName = groupMap.get(pol.target_id) ?? pol.target_id;
		if (!confirm(`คุณต้องการลบนโยบายการเติมสต็อก ${groupName} หรือไม่?`)) {
			return;
		}
		await deleteMutation.mutateAsync({
			id: pol._id,
			shelterCode: pol.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
	}
</script>

<section class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
	<header class="mb-6 flex flex-col gap-4">
		<div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<div>
				<h1 class="text-xl font-semibold">นโยบายการเติมสต็อก (Replenishment Policy)</h1>
				<p class="text-sm text-muted-foreground">
					กำหนดระยะเวลารอคอยสินค้า (Lead Time), รอบการสั่งซื้อ, จุดสั่งเติม (ROP) และจุดวิกฤต (DoC)
				</p>
			</div>

			<div class="flex items-center gap-2">
				<div class="relative w-full sm:w-56">
					<Input
						bind:value={search}
						type="search"
						placeholder="ค้นหานโยบาย..."
						class="pl-9"
						aria-label="ค้นหานโยบาย"
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
					<Button onclick={openCreateModal} class="shrink-0">เพิ่มนโยบาย</Button>
				{/if}
			</div>
		</div>

		<!-- Filter bar -->
		<div class="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
			<div class="flex items-center gap-1.5">
				<label for="filter-group" class="font-medium text-muted-foreground">กลุ่มสารอาหาร:</label>
				<select
					id="filter-group"
					bind:value={filterGroup}
					class="rounded-md border bg-background px-2.5 py-1 text-xs"
				>
					<option value="ALL_GROUPS">ทั้งหมด (ทุกกลุ่ม)</option>
					{#each reqGroups as g (g._id)}
						{@const cleanId = g._id.replace(/^requirement_group:/, '')}
						<option value={cleanId}>{g.name} ({cleanId})</option>
					{/each}
				</select>
			</div>

			<div class="ml-auto text-xs text-muted-foreground">
				แสดง {filteredPolicies.length} จาก {policies.length} รายการ
			</div>
		</div>
	</header>

	{#if policiesQuery.isLoading}
		<div class="flex min-h-[300px] items-center justify-center">
			<div
				class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
			></div>
		</div>
	{:else if filteredPolicies.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
			<p class="font-medium">ไม่พบรายการนโยบายการเติมสต็อก</p>
			{#if isSA || canEditOverride}
				<p class="mt-1 text-sm">คลิกปุ่ม "เพิ่มนโยบาย" เพื่อเริ่มต้นกำหนดค่า</p>
			{/if}
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-left text-sm">
				<thead class="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase">
					<tr>
						<th class="p-3">กลุ่มสำหรับการคำนวณ</th>
						<th class="p-3 text-center">ระยะเวลารอคอย</th>
						<th class="p-3 text-center">รอบสั่งซื้อ</th>
						<th class="p-3 text-center">วันสำรอง</th>
						<th class="p-3 text-center">วันสั่งเติมมาตรฐาน</th>
						<th class="p-3 text-center">Min DoC</th>
						<th class="p-3 text-center">Max DoC</th>
						<th class="p-3">แหล่งที่มา</th>
						<th class="p-3 text-right">การจัดการ</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each filteredPolicies as pol (pol._id)}
						{@const reorderDays = calculateStandardReorderDays(pol)}
						{@const groupName = groupMap.get(pol.target_id)}
						<tr class="hover:bg-muted/30">
							<td class="p-3 font-medium">
								{#if groupName}
									<div class="font-medium text-foreground">{groupName}</div>
									<div class="font-mono text-xs text-muted-foreground">{pol.target_id}</div>
								{:else}
									<div class="font-mono font-medium">{pol.target_id}</div>
								{/if}
							</td>
							<td class="p-3 text-center font-mono text-xs">{pol.lead_time_days} วัน</td>
							<td class="p-3 text-center font-mono text-xs">{pol.review_period_days} วัน</td>
							<td class="p-3 text-center font-mono text-xs">{pol.safety_days} วัน</td>
							<td class="p-3 text-center font-mono font-bold text-primary">{reorderDays} วัน</td>
							<td class="p-3 text-center font-mono text-xs text-amber-600 dark:text-amber-400"
								>{pol.min_doc_days} วัน</td
							>
							<td class="p-3 text-center font-mono text-xs text-blue-600 dark:text-blue-400"
								>{pol.max_doc_days} วัน</td
							>
							<td class="p-3">
								{#if pol.source === 'SHELTER_OVERRIDE'}
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
									{#if isSA || (canEditOverride && pol.source === 'SHELTER_OVERRIDE')}
										<Button variant="outline" size="sm" onclick={() => openEditModal(pol)}>
											แก้ไข
										</Button>
										<Button variant="destructive" size="sm" onclick={() => handleDelete(pol)}>
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

<ReplenishmentPolicyModal
	bind:open={isModalOpen}
	policy={selectedPolicy}
	{shelterCode}
	onClose={() => {
		selectedPolicy = null;
	}}
/>

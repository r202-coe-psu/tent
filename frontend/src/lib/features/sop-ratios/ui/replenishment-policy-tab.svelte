<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { type ReplenishmentPolicy } from '../domain/replenishment-policy';
	import { SOURCE_LABELS } from '$lib/utils/source';
	import { calculateStandardReorderDays } from '../domain/replenishment-calc';
	import {
		useReplenishmentPolicies,
		useDeleteReplenishmentOverride,
		useSetReplenishmentPolicyStatus
	} from '../application/replenishment-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import ReplenishmentPolicyForm from './replenishment-policy-form.svelte';
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

	const policiesQuery = useReplenishmentPolicies(() => shelterCode);
	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const deleteMutation = useDeleteReplenishmentOverride();
	const setStatusMutation = useSetReplenishmentPolicyStatus();

	let search = $state('');
	let filterGroup = $state<string>('ALL_GROUPS');
	let filterStatus = $state<'ALL' | 'active' | 'inactive'>('ALL');

	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedPolicy = $state<ReplenishmentPolicy | null>(null);
	let policyToDelete = $state<ReplenishmentPolicy | null>(null);
	let isDeleteDialogOpen = $state(false);

	const policies = $derived(policiesQuery.data ?? []);
	const reqGroups = $derived(reqGroupsQuery.data ?? []);
	const groupMap = $derived(
		new Map(reqGroups.map((g) => [g._id.replace(/^requirement_group:/, ''), g.name]))
	);

	const filteredPolicies = $derived(
		policies.filter((p) => {
			const status = p.status ?? 'active';
			if (filterStatus !== 'ALL' && status !== filterStatus) {
				return false;
			}
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

	function showCreateForm() {
		selectedPolicy = null;
		viewMode = 'create';
	}

	function showEditForm(pol: ReplenishmentPolicy) {
		selectedPolicy = pol;
		viewMode = 'edit';
	}

	function backToList() {
		viewMode = 'list';
		selectedPolicy = null;
	}

	function openDeleteDialog(pol: ReplenishmentPolicy) {
		policyToDelete = pol;
		isDeleteDialogOpen = true;
	}

	async function handleConfirmDelete() {
		if (!policyToDelete) return;
		try {
			await deleteMutation.mutateAsync({
				id: policyToDelete._id,
				shelterCode: policyToDelete.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			isDeleteDialogOpen = false;
			policyToDelete = null;
		} catch (err) {
			console.error('Failed to deactivate replenishment policy:', err);
		}
	}

	async function handleReactivate(pol: ReplenishmentPolicy) {
		try {
			await setStatusMutation.mutateAsync({
				id: pol._id,
				status: 'active',
				shelterCode: pol.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
		} catch (err) {
			console.error('Failed to activate replenishment policy:', err);
		}
	}
</script>

{#snippet days(n: number | null | undefined)}
	{#if n === null || n === undefined}
		<span class="text-slate-400" aria-label="ไม่ได้ระบุ">-</span>
	{:else}
		{n} <span class="text-xs font-normal text-slate-500">วัน</span>
	{/if}
{/snippet}

{#if viewMode === 'list'}
	<section class="min-w-0">
		<div class="space-y-4">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 class="text-lg font-bold text-slate-900 sm:text-xl">นโยบายการเติมสต็อก</h2>
					<p class="text-sm text-slate-600">กำหนดระยะเวลารอคอยสินค้า, รอบการสั่งซื้อ และจุดวิกฤต</p>
				</div>
				{#if isSA || canEditOverride}
					<Button
						type="button"
						onclick={showCreateForm}
						class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						เพิ่มนโยบาย
					</Button>
				{/if}
			</div>

			<div
				class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
			>
				<div
					class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:grid-cols-[minmax(0,2.2fr)_repeat(2,minmax(0,1fr))] md:p-4"
				>
					<div class="relative col-span-2 md:col-span-1">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
							aria-hidden="true"
						/>
						<Input
							bind:value={search}
							type="search"
							placeholder="ค้นหานโยบาย"
							class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
							aria-label="ค้นหานโยบาย"
						/>
					</div>
					<select
						id="filter-group"
						bind:value={filterGroup}
						aria-label="กรองกลุ่มสารอาหาร"
						class="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<option value="ALL_GROUPS">กลุ่ม: ทั้งหมด</option>
						{#each reqGroups as g (g._id)}
							{@const cleanId = g._id.replace(/^requirement_group:/, '')}
							<option value={cleanId}>กลุ่ม: {g.name} ({cleanId})</option>
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
					กำลังแสดง <strong class="font-semibold text-slate-900 tabular-nums">
						{filteredPolicies.length}
					</strong>
					จาก {policies.length} รายการ
				</p>

				{#if policiesQuery.isLoading}
					<div class="flex-1 space-y-3 p-4" role="status" aria-label="กำลังโหลดนโยบาย">
						{#each [0, 1, 2, 3] as i (i)}
							<div
								class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"
							></div>
						{/each}
					</div>
				{:else if filteredPolicies.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center gap-1 p-12 text-center">
						<p class="text-sm font-medium text-slate-500">ไม่พบรายการนโยบายการเติมสต็อก</p>
						{#if isSA || canEditOverride}
							<p class="text-sm text-slate-500">กดปุ่ม "เพิ่มนโยบาย" เพื่อเริ่มต้นกำหนดค่า</p>
						{/if}
					</div>
				{:else}
					<div class="flex-1 overflow-x-auto">
						<table class="w-full min-w-[960px] text-left text-sm">
							<thead
								class="border-b border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-600"
							>
								<tr>
									<th class="min-w-[200px] p-3.5 pl-4">กลุ่มสำหรับการคำนวณ</th>
									<th class="p-3.5 text-right whitespace-nowrap">ระยะเวลารอคอย</th>
									<th class="p-3.5 text-right whitespace-nowrap">รอบสั่งซื้อ</th>
									<th class="p-3.5 text-right whitespace-nowrap">วันสำรอง</th>
									<th class="p-3.5 text-right whitespace-nowrap text-slate-900">จุดจัดหาเพิ่ม</th>
									<th class="p-3.5 text-right whitespace-nowrap">วันคงคลังขั้นต่ำ</th>
									<th class="p-3.5 text-right whitespace-nowrap">วันคงคลังสูงสุด</th>
									<th class="p-3.5 whitespace-nowrap">สถานะ</th>
									<th class="p-3.5 whitespace-nowrap">แหล่งที่มา</th>
									<th class="p-3.5 pr-4 text-right whitespace-nowrap">
										<span class="sr-only">การจัดการ</span>
									</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each filteredPolicies as pol (pol._id)}
									{@const reorderDays = calculateStandardReorderDays(pol)}
									{@const groupName = groupMap.get(pol.target_id)}
									<tr class="transition-colors hover:bg-slate-50">
										<td class="p-3.5 pl-4">
											{#if groupName}
												<div class="font-bold text-slate-900">{groupName}</div>
												<div class="font-mono text-xs text-slate-500">{pol.target_id}</div>
											{:else}
												<div class="font-mono font-bold text-slate-900">{pol.target_id}</div>
											{/if}
										</td>
										<td class="p-3.5 text-right font-mono whitespace-nowrap text-slate-900">
											{@render days(pol.lead_time_days)}
										</td>
										<td class="p-3.5 text-right font-mono whitespace-nowrap text-slate-900">
											{@render days(pol.review_period_days)}
										</td>
										<td class="p-3.5 text-right font-mono whitespace-nowrap text-slate-900">
											{@render days(pol.safety_days)}
										</td>
										<td
											class="p-3.5 text-right font-mono font-bold whitespace-nowrap text-slate-900"
										>
											{@render days(reorderDays)}
										</td>
										<td class="p-3.5 text-right font-mono whitespace-nowrap text-amber-700">
											{@render days(pol.min_doc_days)}
										</td>
										<td class="p-3.5 text-right font-mono whitespace-nowrap text-sky-700">
											{@render days(pol.max_doc_days)}
										</td>
										<td class="p-3.5">
											{#if (pol.status ?? 'active') === 'active'}
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
										</td>
										<td class="p-3.5">
											{#if pol.source === 'SHELTER_OVERRIDE'}
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
										</td>
										<td class="p-3.5 pr-4 text-right">
											<div class="flex items-center justify-end gap-2">
												{#if isSA || canEditOverride}
													<Button
														variant="outline"
														onclick={() => showEditForm(pol)}
														class="min-h-11 gap-1.5 rounded-lg border-slate-300 text-sm font-semibold whitespace-nowrap"
													>
														<Settings2 class="h-3.5 w-3.5" aria-hidden="true" />
														แก้ไข
													</Button>
													{#if isSA || pol.source === 'SHELTER_OVERRIDE'}
														{#if (pol.status ?? 'active') === 'active'}
															<Button
																variant="destructive"
																onclick={() => openDeleteDialog(pol)}
																class="min-h-11 gap-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
															>
																<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
																ปิดใช้งาน
															</Button>
														{:else}
															<Button
																variant="outline"
																disabled={setStatusMutation.isPending}
																onclick={() => handleReactivate(pol)}
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
						<span>แก้ไขนโยบายการเติมสต็อก</span>
					{:else}
						<span>บันทึกนโยบายการเติมสต็อกใหม่</span>
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
			<ReplenishmentPolicyForm
				policy={selectedPolicy}
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
			<AlertDialog.Title>ยืนยันการปิดใช้งานนโยบายการเติมสต็อก</AlertDialog.Title>
			<AlertDialog.Description>
				{#if policyToDelete}
					{@const groupName = groupMap.get(policyToDelete.target_id) ?? policyToDelete.target_id}
					คุณต้องการปิดการใช้งานนโยบายการเติมสต็อกสำหรับ
					<span class="font-semibold text-foreground">{groupName}</span>
					({policyToDelete.target_id}) ใช่หรือไม่?
					<br /><br />
					<span class="text-xs text-muted-foreground">
						การปิดใช้งานจะทำให้นโยบายนี้ไม่ถูกนำไปคำนวณ Standard Reorder Days และ Min/Max DoC
						ในตารางวางแผน แต่ข้อมูลเดิมจะยังคงอยู่และสามารถเปิดใช้งานกลับมาได้ตลอดเวลา
					</span>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				disabled={deleteMutation.isPending}
				onclick={() => {
					policyToDelete = null;
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

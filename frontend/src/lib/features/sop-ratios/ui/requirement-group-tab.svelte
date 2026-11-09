<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import {
		useRequirementGroups,
		useDeleteRequirementGroup,
		useSetRequirementGroupStatus
	} from '../application/requirement-group-queries';
	import { type RequirementGroup } from '../domain/requirement-group';
	import { SOURCE_LABELS } from '$lib/utils/source';
	import { useItemMasters } from '$lib/features/catalog';
	import RequirementGroupForm from './requirement-group-form.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

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

	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const deleteMutation = useDeleteRequirementGroup();
	const setStatusMutation = useSetRequirementGroupStatus();
	const itemMastersQuery = useItemMasters();

	let search = $state('');
	let filterStatus = $state<'ALL' | 'active' | 'inactive'>('ALL');
	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedGroup = $state<RequirementGroup | null>(null);
	let groupToDelete = $state<RequirementGroup | null>(null);
	let isDeleteDialogOpen = $state(false);

	const groups = $derived(reqGroupsQuery.data ?? []);
	const itemNameMap = $derived(
		new Map(
			(itemMastersQuery.data ?? []).map((im) => [
				im._id,
				im.sku ? `${im.name} (${im.sku})` : im.name
			])
		)
	);
	const filteredGroups = $derived(
		groups.filter((g) => {
			const status = g.status ?? 'active';
			if (filterStatus !== 'ALL' && status !== filterStatus) return false;

			const q = search.trim().toLowerCase();
			if (!q) return true;
			const matchesBasic =
				g.name.toLowerCase().includes(q) ||
				g._id.toLowerCase().includes(q) ||
				g.standard_uom.toLowerCase().includes(q);
			if (matchesBasic) return true;

			return (g.item_maps ?? []).some((m) => {
				const im = (itemMastersQuery.data ?? []).find((item) => item._id === m.item_id);
				return (
					m.item_id.toLowerCase().includes(q) ||
					(im?.name && im.name.toLowerCase().includes(q)) ||
					(im?.sku && im.sku.toLowerCase().includes(q))
				);
			});
		})
	);

	function showCreateForm() {
		selectedGroup = null;
		viewMode = 'create';
	}

	function showEditForm(group: RequirementGroup) {
		selectedGroup = group;
		viewMode = 'edit';
	}

	function backToList() {
		viewMode = 'list';
		selectedGroup = null;
	}

	function openDeleteDialog(group: RequirementGroup) {
		groupToDelete = group;
		isDeleteDialogOpen = true;
	}

	async function handleConfirmDelete() {
		if (!groupToDelete) return;
		try {
			await deleteMutation.mutateAsync({
				id: groupToDelete._id,
				shelterCode: groupToDelete.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			isDeleteDialogOpen = false;
			groupToDelete = null;
		} catch (err) {
			console.error('Failed to deactivate requirement group:', err);
		}
	}

	async function handleReactivate(group: RequirementGroup) {
		try {
			await setStatusMutation.mutateAsync({
				id: group._id,
				status: 'active',
				shelterCode: group.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
		} catch (err) {
			console.error('Failed to activate requirement group:', err);
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
					<h2 class="text-lg font-bold text-slate-900 sm:text-xl">
						กลุ่มสารอาหาร & หน่วยนับมาตรฐาน
					</h2>
					<p class="text-sm text-slate-600">
						จัดการกลุ่มความต้องการสารอาหาร หน่วยนับกลาง และรายการสินค้าในกลุ่ม
					</p>
				</div>
				{#if isSA || canEditOverride}
					<Button
						type="button"
						onclick={showCreateForm}
						class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						เพิ่มกลุ่มความต้องการ
					</Button>
				{/if}
			</div>

			<div
				class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
			>
				<div
					class="grid grid-cols-2 gap-2.5 border-b border-slate-200/80 p-3 md:grid-cols-4 md:p-4"
				>
					<div class="relative col-span-2">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500"
							aria-hidden="true"
						/>
						<Input
							bind:value={search}
							type="search"
							placeholder="ค้นหากลุ่มความต้องการ"
							class="min-h-11 w-full rounded-lg border-slate-300 bg-white pl-9 text-base shadow-2xs md:text-sm"
							aria-label="ค้นหากลุ่มความต้องการ"
						/>
					</div>
					<div class="col-span-2">
						<Select.Root type="single" bind:value={filterStatus}>
							<Select.Trigger
								class="min-h-11 w-full rounded-lg border-slate-300 bg-white text-sm shadow-2xs"
								aria-label="กรองสถานะ"
							>
								สถานะ: {filterStatus === 'ALL'
									? 'ทั้งหมด'
									: filterStatus === 'active'
										? 'ใช้งานอยู่'
										: 'ปิดใช้งาน'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="ALL" label="ทั้งหมด" />
								<Select.Item value="active" label="ใช้งานอยู่" />
								<Select.Item value="inactive" label="ปิดใช้งาน" />
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<p class="border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600">
					กำลังแสดง <strong class="font-semibold text-slate-900 tabular-nums"
						>{filteredGroups.length}</strong
					> รายการ
				</p>

				{#if reqGroupsQuery.isLoading}
					<div class="flex-1 space-y-3 p-4" role="status" aria-label="กำลังโหลด">
						{#each [0, 1, 2, 3] as i (i)}
							<div
								class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"
							></div>
						{/each}
					</div>
				{:else if filteredGroups.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center gap-1 p-12 text-center">
						<p class="text-sm font-medium text-slate-500">ไม่พบข้อมูลกลุ่มความต้องการ</p>
						{#if isSA || canEditOverride}
							<p class="text-sm text-slate-500">
								กดปุ่ม "เพิ่มกลุ่มความต้องการ" เพื่อเริ่มต้นกำหนดกลุ่มสารอาหาร
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
									<th class="min-w-[200px] p-3.5 pl-4 whitespace-nowrap">ชื่อกลุ่มความต้องการ</th>
									<th class="p-3.5 whitespace-nowrap">รหัสกลุ่ม</th>
									<th class="p-3.5 whitespace-nowrap">หน่วยนับมาตรฐาน</th>
									<th class="min-w-[220px] p-3.5 whitespace-nowrap">สินค้าที่อยู่ในกลุ่ม</th>
									<th class="p-3.5 whitespace-nowrap">สถานะ</th>
									<th class="p-3.5 whitespace-nowrap">แหล่งที่มา</th>
									<th class="p-3.5 pr-4 text-right whitespace-nowrap"
										><span class="sr-only">การจัดการ</span></th
									>
								</tr>
							</thead>
							<tbody class="divide-y divide-slate-100">
								{#each filteredGroups as group (group._id)}
									<tr class="transition-colors hover:bg-slate-50">
										<td class="p-3.5 pl-4 font-bold text-slate-900">{group.name}</td>
										<td class="p-3.5 font-mono text-xs whitespace-nowrap text-slate-500">
											{group._id.replace(/^requirement_group:/, '')}
										</td>
										<td class="p-3.5">
											<span
												class="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold whitespace-nowrap text-slate-900"
											>
												{group.standard_uom}
											</span>
										</td>
										<td class="p-3.5 text-slate-600">
											{#if (group.item_maps ?? []).length > 0}
												<span class="text-xs">
													{(group.item_maps ?? []).length} รายการ ({(group.item_maps ?? [])
														.map((m) => itemNameMap.get(m.item_id) ?? m.item_id)
														.join(', ')})
												</span>
											{:else}
												<span class="text-xs text-slate-400 italic">ยังไม่มีสินค้าในกลุ่ม</span>
											{/if}
										</td>
										<td class="p-3.5"
											>{@render statusBadge((group.status ?? 'active') === 'active')}</td
										>
										<td class="p-3.5">{@render sourceBadge(group.source)}</td>
										<td class="p-3.5 pr-4 text-right">
											<div class="flex items-center justify-end gap-2">
												{#if isSA || canEditOverride}
													<Button
														variant="outline"
														onclick={() => showEditForm(group)}
														class="min-h-11 gap-1.5 rounded-lg border-slate-300 text-sm font-semibold whitespace-nowrap"
													>
														<Settings2 class="h-3.5 w-3.5" aria-hidden="true" />
														แก้ไข
													</Button>
													{#if isSA || group.source === 'SHELTER_OVERRIDE'}
														{#if (group.status ?? 'active') === 'active'}
															<Button
																variant="destructive"
																onclick={() => openDeleteDialog(group)}
																class="min-h-11 gap-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
															>
																<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
																ปิดใช้งาน
															</Button>
														{:else}
															<Button
																variant="outline"
																disabled={setStatusMutation.isPending}
																onclick={() => handleReactivate(group)}
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
						<span>แก้ไขกลุ่มความต้องการ</span>
					{:else}
						<span>บันทึกกลุ่มความต้องการใหม่</span>
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
			<RequirementGroupForm
				group={selectedGroup}
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
			<AlertDialog.Title>ยืนยันการปิดใช้งานกลุ่มสารอาหาร & หน่วยนับมาตรฐาน</AlertDialog.Title>
			<AlertDialog.Description>
				{#if groupToDelete}
					คุณต้องการปิดการใช้งานกลุ่มความต้องการ <span class="font-semibold text-foreground"
						>"{groupToDelete.name}"</span
					>
					({groupToDelete._id.replace(/^requirement_group:/, '')}) ใช่หรือไม่?
					<br /><br />
					<span class="text-xs text-muted-foreground">
						การปิดใช้งานจะทำให้ไม่สามารถเลือกกลุ่มนี้ในเกณฑ์โภชนาการใหม่ได้
						แต่ข้อมูลเดิมที่เคยบันทึกไว้จะยังคงแสดงผลตามปกติ และสามารถเปิดใช้งานกลับมาได้ตลอดเวลา
					</span>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				disabled={deleteMutation.isPending}
				onclick={() => {
					groupToDelete = null;
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

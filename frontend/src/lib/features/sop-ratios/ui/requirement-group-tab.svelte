<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import {
		useRequirementGroups,
		useDeleteRequirementGroup
	} from '../application/requirement-group-queries';
	import { type RequirementGroup } from '../domain/requirement-group';
	import { SOURCE_LABELS } from '$lib/utils/source';
	import RequirementGroupForm from './requirement-group-form.svelte';

	// Icons
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';

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

	let search = $state('');
	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedGroup = $state<RequirementGroup | null>(null);

	const groups = $derived(reqGroupsQuery.data ?? []);
	const filteredGroups = $derived(
		groups.filter(
			(g) =>
				g.name.toLowerCase().includes(search.toLowerCase()) ||
				g._id.toLowerCase().includes(search.toLowerCase()) ||
				g.standard_uom.toLowerCase().includes(search.toLowerCase())
		)
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

	async function handleDelete(group: RequirementGroup) {
		if (!confirm(`คุณต้องการลบกลุ่มความต้องการ "${group.name}" (${group._id}) หรือไม่?`)) {
			return;
		}
		await deleteMutation.mutateAsync({
			id: group._id,
			shelterCode: group.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
	}
</script>

{#if viewMode === 'list'}
	<section class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
		<header class="mb-6 flex flex-col gap-4">
			<div
				class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
			>
				<div>
					<h1 class="text-xl font-semibold">กลุ่มสารอาหาร & หน่วยนับมาตรฐาน</h1>
					<p class="text-sm text-muted-foreground">
						จัดการกลุ่มความต้องการสารอาหาร หน่วยนับกลาง และรายการสินค้าคู่เทียบ
					</p>
				</div>

				<div class="flex items-center gap-2">
					<div class="relative w-full sm:w-64">
						<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							bind:value={search}
							type="search"
							placeholder="ค้นหากลุ่มความต้องการ..."
							class="pl-9"
							aria-label="ค้นหากลุ่มความต้องการ"
						/>
					</div>

					{#if isSA || canEditOverride}
						<Button onclick={showCreateForm} class="flex shrink-0 items-center gap-1.5">
							<Plus class="h-4 w-4" />
							เพิ่มกลุ่มความต้องการ
						</Button>
					{/if}
				</div>
			</div>
		</header>

		{#if reqGroupsQuery.isLoading}
			<div class="flex min-h-80 items-center justify-center">
				<div
					class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
				></div>
			</div>
		{:else if filteredGroups.length === 0}
			<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
				<p class="font-medium">ไม่พบข้อมูลกลุ่มความต้องการ</p>
				{#if isSA || canEditOverride}
					<p class="mt-1 text-sm">
						คลิกปุ่ม "เพิ่มกลุ่มความต้องการ" เพื่อเริ่มต้นกำหนดกลุ่มสารอาหาร
					</p>
				{/if}
			</div>
		{:else}
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-left text-sm">
					<thead class="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase">
						<tr>
							<th class="p-3">ชื่อกลุ่มความต้องการ</th>
							<th class="p-3">รหัสกลุ่ม (ID)</th>
							<th class="p-3">หน่วยนับมาตรฐาน</th>
							<th class="p-3">สินค้าคู่เทียบ (Item Maps)</th>
							<th class="p-3">แหล่งที่มา</th>
							<th class="p-3 text-right">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each filteredGroups as group (group._id)}
							<tr class="hover:bg-muted/30">
								<td class="p-3 font-medium text-foreground">{group.name}</td>
								<td class="p-3 font-mono text-muted-foreground">
									{group._id.replace(/^requirement_group:/, '')}
								</td>
								<td class="p-3">
									<span class="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
										{group.standard_uom}
									</span>
								</td>
								<td class="p-3">
									{#if (group.item_maps ?? []).length > 0}
										<span class="text-xs text-muted-foreground">
											{(group.item_maps ?? []).length} รายการ ({(group.item_maps ?? [])
												.map((m) => m.item_id)
												.join(', ')})
										</span>
									{:else}
										<span class="text-xs text-muted-foreground italic">ไม่มีสินค้าคู่เทียบ</span>
									{/if}
								</td>
								<td class="p-3">
									{#if group.source === 'SHELTER_OVERRIDE'}
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
										{#if isSA || (canEditOverride && group.source === 'SHELTER_OVERRIDE')}
											<Button
												variant="outline"
												size="sm"
												onclick={() => showEditForm(group)}
												class="flex items-center gap-1"
											>
												<Settings2 class="h-3.5 w-3.5" />
												แก้ไข
											</Button>
											<Button
												variant="destructive"
												size="sm"
												onclick={() => handleDelete(group)}
												class="flex items-center gap-1"
											>
												<Trash2 class="h-3.5 w-3.5" />
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
{:else}
	<div
		class="w-full rounded-2xl border border-slate-100 bg-card p-6 shadow-sm md:p-8 dark:border-zinc-800"
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

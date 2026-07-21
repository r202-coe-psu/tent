<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type {
		MasterDataItem,
		MasterDataQueryContext,
		MasterDataType
	} from '$lib/features/master-data';
	import { MASTER_DATA_TYPE_LABELS } from '$lib/features/master-data';
	import { useDeleteMasterItem } from '$lib/features/master-data';

	let {
		type,
		items,
		context,
		onAdd,
		onEdit
	}: {
		type: MasterDataType;
		items: readonly MasterDataItem[];
		context?: MasterDataQueryContext;
		onAdd: () => void;
		onEdit: (item: MasterDataItem) => void;
	} = $props();

	const deleteMutation = useDeleteMasterItem();

	let search = $state('');

	const filtered = $derived(
		search.trim()
			? items.filter((i) => i.label.toLowerCase().includes(search.trim().toLowerCase()))
			: items
	);

	function handleDelete(item: MasterDataItem) {
		if (!confirm(`ลบ "${item.label}" ออกจาก ${MASTER_DATA_TYPE_LABELS[type]}?`)) return;
		deleteMutation.mutate({ type, code: item.code, context });
	}
</script>

<section
	class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
	aria-label="รายการข้อมูล"
>
	<header class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-xl font-semibold">รายการข้อมูล ({items.length})</h1>
		<div class="flex items-center gap-2">
			<div class="relative w-full sm:w-64">
				<Input
					bind:value={search}
					type="search"
					placeholder="ค้นหา..."
					class="pl-9"
					aria-label="ค้นหา"
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
			<Button type="button" onclick={onAdd} class="shrink-0">
				<svg
					class="mr-1 h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M12 5v14M5 12h14" />
				</svg>
				เพิ่มข้อมูล
			</Button>
		</div>
	</header>

	<div class="overflow-hidden rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground">
				<tr>
					<th class="px-4 py-3 text-left font-semibold">ข้อมูลมาตรฐาน</th>
					<th class="px-4 py-3 text-right font-semibold">จัดการ</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as item (item.code)}
					<tr class="border-t hover:bg-muted/30">
						<td class="px-4 py-3">
							<div class="font-medium">{item.label}</div>
							{#if item.is_default}
								<span
									class="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
								>
									ค่าเริ่มต้น
								</span>
							{/if}
						</td>
						<td class="px-4 py-3">
							<div class="flex items-center justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="border-blue-200 text-blue-700 hover:bg-blue-50"
									onclick={() => onEdit(item)}
									aria-label="จัดการ {item.label}"
								>
									<svg
										class="mr-1 h-3.5 w-3.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
									</svg>
									จัดการ
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="border-red-200 text-red-700 hover:bg-red-50"
									onclick={() => handleDelete(item)}
									disabled={deleteMutation.isPending}
									aria-label="ลบ {item.label}"
								>
									<svg
										class="mr-1 h-3.5 w-3.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path
											d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
										/>
									</svg>
									ลบ
								</Button>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="2" class="px-4 py-8 text-center text-muted-foreground">
							{search.trim()
								? 'ไม่พบรายการที่ค้นหา'
								: 'ยังไม่มีข้อมูล — กดปุ่ม "เพิ่มข้อมูล" เพื่อเริ่ม'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { useAuditLog } from '../application/queries';
	import AuditEventList from './audit-event-list.svelte';

	let {
		entityType,
		entityId,
		shelterCode = null,
		title = 'ประวัติการแก้ไข'
	}: {
		entityType: string;
		entityId: string;
		shelterCode?: string | null;
		title?: string;
	} = $props();

	const query = useAuditLog(
		() => ({
			entity_type: entityType,
			entity_id: entityId,
			shelter_code: shelterCode ?? undefined,
			limit: 10
		}),
		() => Boolean(entityId)
	);

	const items = $derived(query.data?.pages.flatMap((p) => p.items) ?? []);
</script>

<section
	class="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6"
	data-testid="entity-history"
>
	<h3 class="text-base font-semibold text-slate-800">{title}</h3>
	{#if query.isLoading}
		<p class="text-sm text-slate-500" role="status">กำลังโหลดประวัติ...</p>
	{:else if query.isError}
		<p class="text-sm text-red-700" role="status">โหลดประวัติไม่สำเร็จ</p>
	{:else if items.length === 0 && !query.hasNextPage}
		<p class="text-sm text-slate-500">ยังไม่มีประวัติการแก้ไข</p>
	{:else}
		{#if items.length === 0}
			<p class="text-sm text-slate-500">
				ยังไม่พบประวัติในช่วงที่ค้นไปแล้ว — กดโหลดเพิ่มเพื่อค้นต่อ
			</p>
		{:else}
			<AuditEventList {items} />
		{/if}
		{#if query.hasNextPage}
			<Button
				type="button"
				variant="outline"
				class="min-h-11 w-full sm:w-auto"
				disabled={query.isFetchingNextPage}
				onclick={() => query.fetchNextPage()}
			>
				{query.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
			</Button>
		{/if}
	{/if}
</section>

<script lang="ts">
	import { useShelter } from '../application/queries';
	import { listStoragePoints } from '../domain/storage-points';
	import { SUB_STORAGE_TYPE_LABELS } from '../domain/storage-points';
	import * as Table from '$lib/components/ui/table/index.js';
	import Warehouse from '@lucide/svelte/icons/warehouse';

	let { shelterCode }: { shelterCode: () => string } = $props();

	const shelterQuery = useShelter(() => shelterCode());
	const points = $derived(listStoragePoints(shelterQuery.data));
</script>

<!--
	CR-175 (#647) — read-only view of the shelter's storage points and the
	item types each one can hold. Edited from the shelter form's "จุดเก็บของ"
	section (StoragePointsSection); this table only displays the result.
-->
<div class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<div class="flex items-center gap-3 border-b border-slate-100 p-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700"
		>
			<Warehouse class="h-5 w-5" />
		</div>
		<div>
			<h3 class="text-base font-bold text-[#0A2647]">จุดเก็บของของศูนย์</h3>
			<p class="text-sm text-slate-500">ประเภทของที่เก็บได้ในแต่ละจุด — แก้ไขได้จากฟอร์มศูนย์</p>
		</div>
	</div>

	{#if shelterQuery.isLoading}
		<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด…</p>
	{:else if points.length === 0}
		<p class="p-6 text-center text-sm text-muted-foreground">
			ศูนย์นี้ยังไม่มีจุดเก็บของ — เพิ่มได้จากฟอร์มแก้ไขศูนย์ (ส่วนที่ 5)
		</p>
	{:else}
		<Table.Root class="text-sm">
			<Table.Header class="border-b border-slate-200/80 bg-slate-50">
				<Table.Row class="text-xs font-semibold text-slate-600">
					<Table.Head class="px-4 py-3">ชื่อจุดเก็บของ</Table.Head>
					<Table.Head class="px-4 py-3">พื้นที่ (ตร.ม.)</Table.Head>
					<Table.Head class="px-4 py-3">ประเภทที่เก็บได้</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-slate-100">
				{#each points as point (point.id)}
					<Table.Row>
						<Table.Cell class="px-4 py-3 font-semibold text-slate-800">{point.name}</Table.Cell>
						<Table.Cell class="px-4 py-3 text-slate-600 tabular-nums">
							{point.area_m2 ?? '—'}
						</Table.Cell>
						<Table.Cell class="px-4 py-3">
							<div class="flex flex-wrap gap-1.5">
								{#each point.types as type (type)}
									<span
										class="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-900"
									>
										{SUB_STORAGE_TYPE_LABELS[type]}
									</span>
								{/each}
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

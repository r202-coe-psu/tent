<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { ShelterSummary } from '../data/shelters.repository';
	import type { OperationStatus } from '../domain/schema';

	let {
		shelters,
		onedit
	}: {
		shelters: ShelterSummary[];
		onedit: (shelter: ShelterSummary) => void;
	} = $props();

	const statusConfig: Record<OperationStatus, { label: string; class: string }> = {
		standby: {
			label: 'เตรียมพร้อม',
			class: 'bg-muted text-muted-foreground'
		},
		active: {
			label: 'เปิดรับ',
			class: 'bg-shelter-emerald-bg text-shelter-emerald-text'
		},
		full_capacity: {
			label: 'เต็ม',
			class: 'bg-shelter-amber-bg text-shelter-amber-text'
		},
		closed: {
			label: 'ปิด',
			class: 'bg-shelter-rose-bg text-shelter-rose-text'
		}
	};
</script>

{#if shelters.length === 0}
	<p class="text-sm text-muted-foreground">No shelters yet.</p>
{:else}
	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>รหัส</Table.Head>
					<Table.Head>ชื่อศูนย์</Table.Head>
					<Table.Head class="text-right">ความจุ</Table.Head>
					<Table.Head>สถานะ</Table.Head>
					<Table.Head class="text-center">จัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each shelters as shelter (shelter.code)}
					<Table.Row>
						<Table.Cell class="font-mono font-bold text-foreground">{shelter.code}</Table.Cell>
						<Table.Cell>{shelter.name}</Table.Cell>
						<Table.Cell class="text-right font-semibold">{shelter.capacity}</Table.Cell>
						<Table.Cell>
							<span
								class="rounded px-2 py-0.5 text-[11px] font-bold {statusConfig[
									shelter.operation_status
								]?.class ?? 'bg-muted text-muted-foreground'}"
							>
								{statusConfig[shelter.operation_status]?.label ?? shelter.operation_status}
							</span>
						</Table.Cell>
						<Table.Cell class="text-center">
							<Button variant="outline" size="sm" onclick={() => onedit(shelter)} title="แก้ไข">
								<Pencil class="h-3.5 w-3.5" />
							</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
{/if}

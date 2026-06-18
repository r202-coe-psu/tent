<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { ShelterSummary } from '../data/shelters.api';

	let {
		shelters,
		onedit
	}: {
		shelters: ShelterSummary[];
		onedit: (shelter: ShelterSummary) => void;
	} = $props();
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
					<Table.Head>ความจุ</Table.Head>
					<Table.Head>สถานะ</Table.Head>
					<Table.Head class="text-center">จัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each shelters as shelter (shelter.code)}
					<Table.Row>
						<Table.Cell class="font-mono font-bold text-foreground">{shelter.code}</Table.Cell>
						<Table.Cell>{shelter.name}</Table.Cell>
						<Table.Cell class="font-semibold">{shelter.capacity}</Table.Cell>
						<Table.Cell>
							<span class="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
								{shelter.status}
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

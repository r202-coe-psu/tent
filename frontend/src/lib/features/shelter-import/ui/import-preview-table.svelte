<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { RowValidation } from '../domain/import-row';

	let { validations }: { validations: RowValidation[] } = $props();
</script>

<div class="overflow-x-auto rounded-xl border border-border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="w-16 text-center">แถว</Table.Head>
				<Table.Head>ชื่อศูนย์พักพิง</Table.Head>
				<Table.Head class="w-28 text-center">สถานะ</Table.Head>
				<Table.Head>ข้อผิดพลาด</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each validations as v (v.row)}
				<Table.Row class={v.ok ? '' : 'bg-destructive/5'}>
					<Table.Cell class="text-center text-muted-foreground">{v.row}</Table.Cell>
					<Table.Cell class="font-medium">{v.name ?? '—'}</Table.Cell>
					<Table.Cell class="text-center">
						{#if v.ok}
							<Badge variant="secondary">พร้อมนำเข้า</Badge>
						{:else}
							<Badge variant="destructive">ผิดพลาด</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell>
						{#if v.errors.length > 0}
							<ul class="space-y-1 text-sm text-destructive">
								{#each v.errors as err (err.column + err.message)}
									<li><span class="font-medium">{err.column}:</span> {err.message}</li>
								{/each}
							</ul>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

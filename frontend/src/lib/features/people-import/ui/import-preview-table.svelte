<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { RowValidation } from '../domain/import-row';
	import type { DuplicateMatch } from '../domain/duplicates';

	let {
		validations,
		duplicates = new Map<number, DuplicateMatch>()
	}: {
		validations: RowValidation[];
		duplicates?: Map<number, DuplicateMatch>;
	} = $props();
</script>

<div class="overflow-x-auto rounded-xl border border-border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="w-16 text-center">แถว</Table.Head>
				<Table.Head>ครัวเรือน</Table.Head>
				<Table.Head>หัวหน้าครัวเรือน</Table.Head>
				<Table.Head class="w-20 text-center">สมาชิก</Table.Head>
				<Table.Head class="w-32 text-center">สถานะ</Table.Head>
				<Table.Head>ข้อผิดพลาด / หมายเหตุ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each validations as v (v.row)}
				{@const duplicate = duplicates.get(v.row)}
				<Table.Row class={v.ok ? '' : 'bg-destructive/5'}>
					<Table.Cell class="text-center text-muted-foreground">{v.row}</Table.Cell>
					<Table.Cell class="font-medium">{v.label ?? '—'}</Table.Cell>
					<Table.Cell>{v.headName ?? '—'}</Table.Cell>
					<Table.Cell class="text-center text-muted-foreground">
						{v.memberCount + 1} คน
					</Table.Cell>
					<Table.Cell class="text-center">
						{#if v.ok && duplicate?.head}
							<Badge variant="outline" class="border-amber-300 text-amber-700">ซ้ำ — จะข้าม</Badge>
						{:else if v.ok && duplicate}
							<Badge variant="outline" class="border-amber-300 text-amber-700">
								ข้าม {duplicate.members.length} คน
							</Badge>
						{:else if v.ok}
							<Badge variant="secondary">พร้อมนำเข้า</Badge>
						{:else}
							<Badge variant="destructive">ผิดพลาด</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell>
						{#if v.errors.length > 0}
							<ul class="space-y-1 text-sm text-destructive">
								{#each v.errors as err (err.column + err.message + (err.line ?? ''))}
									<li>
										{#if err.sheet}
											<span class="text-muted-foreground">
												[{err.sheet}{err.line === undefined ? '' : ` แถว ${err.line}`}]
											</span>
										{/if}
										<span class="font-medium">{err.column}:</span>
										{err.message}
									</li>
								{/each}
							</ul>
						{:else if duplicate?.head}
							<span class="text-sm text-amber-700">
								"{duplicate.head.name}" มีอยู่ในศูนย์นี้แล้ว — ทั้งครัวเรือนจะไม่ถูกนำเข้า
							</span>
						{:else if duplicate}
							<span class="text-sm text-amber-700">
								มีอยู่ในศูนย์นี้แล้ว: {duplicate.members.map((m) => m.name).join(', ')}
							</span>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

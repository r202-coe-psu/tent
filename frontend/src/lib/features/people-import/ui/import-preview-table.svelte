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

{#snippet statusBadge(v: RowValidation, duplicate: DuplicateMatch | undefined)}
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
{/snippet}

{#snippet notes(v: RowValidation, duplicate: DuplicateMatch | undefined)}
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
{/snippet}

<ul
	role="list"
	class="divide-y rounded-xl border border-border md:hidden"
	data-testid="import-preview-cards"
>
	{#each validations as v (v.row)}
		{@const duplicate = duplicates.get(v.row)}
		<li class="space-y-2 p-3 {v.ok ? '' : 'bg-destructive/5'}">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-xs text-muted-foreground">แถว {v.row} · {v.memberCount + 1} คน</p>
					<p class="font-medium break-words">{v.label ?? '—'}</p>
					<p class="text-sm break-words text-muted-foreground">
						หัวหน้าครัวเรือน: {v.headName ?? '—'}
					</p>
				</div>
				<div class="shrink-0">{@render statusBadge(v, duplicate)}</div>
			</div>
			<div class="text-sm break-words">{@render notes(v, duplicate)}</div>
		</li>
	{/each}
</ul>

<div class="hidden overflow-x-auto rounded-xl border border-border md:block">
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
						{@render statusBadge(v, duplicate)}
					</Table.Cell>
					<Table.Cell>
						{@render notes(v, duplicate)}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

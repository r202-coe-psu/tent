<script lang="ts">
	import type { MasterDataItem } from '$lib/features/master-data';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Star from '@lucide/svelte/icons/star';
	import Power from '@lucide/svelte/icons/power';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	let { items, onEdit, onSetDefault, onToggleStatus, onDelete } = $props<{
		items: readonly MasterDataItem[];
		onEdit: (item: MasterDataItem) => void;
		onSetDefault: (item: MasterDataItem) => void;
		onToggleStatus: (item: MasterDataItem) => void;
		onDelete: (item: MasterDataItem) => void;
	}>();
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	{#if items.length === 0}
		<div class="flex flex-col items-center justify-center p-12 text-center">
			<AlertCircle class="h-10 w-10 text-muted-foreground/50" />
			<h3 class="mt-3 text-sm font-bold text-foreground">ไม่พบทักษะที่ตรงกับเงื่อนไข</h3>
			<p class="mt-1 text-xs text-muted-foreground">ลองเปลี่ยนคำค้นหาหรือตัวกรองด้านบน</p>
		</div>
	{:else}
		<Table.Root class="w-full text-xs">
			<Table.Header class="border-b border-border bg-muted/50 font-bold text-muted-foreground">
				<Table.Row class="hover:bg-transparent">
					<Table.Head class="w-12 text-center">#</Table.Head>
					<Table.Head class="w-48">รหัสทักษะ (Value / Key)</Table.Head>
					<Table.Head>ชื่อทักษะ (Label & Description)</Table.Head>
					<Table.Head class="w-44">ประเภททักษะ</Table.Head>
					<Table.Head class="w-28 text-center">สถานะ</Table.Head>
					<Table.Head class="w-36 text-right">การจัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border">
				{#each items as item, idx (item.code)}
					{@const isControlled = item.category === 'controlled'}
					{@const isActive = item.status !== 'inactive'}
					<Table.Row
						class="transition-colors hover:bg-muted/20 {isActive ? '' : 'bg-muted/10 opacity-60'}"
					>
						<Table.Cell class="text-center font-mono text-muted-foreground">
							{idx + 1}
						</Table.Cell>
						<Table.Cell>
							<span
								class="inline-block rounded-md border border-border/80 bg-muted px-2.5 py-1 font-mono text-2xs font-bold text-foreground"
							>
								{item.code}
							</span>
						</Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-2">
								<span class="text-sm font-bold text-foreground">{item.label}</span>
								{#if item.is_default}
									<Badge
										variant="outline"
										class="inline-flex items-center gap-1 rounded-full border-primary/20 bg-primary/10 px-2 py-0.5 text-3xs font-bold text-primary"
									>
										<Star class="h-2.5 w-2.5 fill-primary" /> ค่าเริ่มต้น
									</Badge>
								{/if}
							</div>
							{#if item.description}
								<p class="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
									{item.description}
								</p>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if isControlled}
								<Badge
									variant="outline"
									class="inline-flex items-center gap-1.5 rounded-full border-warning/30 bg-warning/15 px-2.5 py-1 text-2xs font-bold text-warning-foreground"
								>
									<ShieldAlert class="h-3 w-3 shrink-0" />
									ทักษะควบคุม
								</Badge>
							{:else}
								<Badge
									variant="outline"
									class="inline-flex items-center gap-1.5 rounded-full border-success/20 bg-success/10 px-2.5 py-1 text-2xs font-bold text-success"
								>
									<Sparkles class="h-3 w-3 shrink-0" />
									ทักษะทั่วไป
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-center">
							{#if isActive}
								<span class="inline-flex items-center gap-1 text-2xs font-bold text-success">
									<span class="h-1.5 w-1.5 rounded-full bg-success"></span> ใช้งาน
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1 text-2xs font-bold text-muted-foreground"
								>
									<span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span> ปิดใช้งาน
								</span>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right">
							<div class="inline-flex items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
									onclick={() => onEdit(item)}
									title="แก้ไขข้อมูล"
								>
									<Pencil class="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-primary {item.is_default
										? 'text-primary'
										: ''}"
									onclick={() => onSetDefault(item)}
									title={item.is_default ? 'เป็นค่าเริ่มต้นอยู่แล้ว' : 'ตั้งเป็นค่าเริ่มต้น'}
								>
									<Star class="h-4 w-4 {item.is_default ? 'fill-primary' : ''}" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 cursor-pointer rounded-lg p-1.5 hover:bg-muted {isActive
										? 'text-muted-foreground hover:text-warning'
										: 'text-success'}"
									onclick={() => onToggleStatus(item)}
									title={isActive ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
								>
									<Power class="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
									onclick={() => onDelete(item)}
									title="ลบทักษะ"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

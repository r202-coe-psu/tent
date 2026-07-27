<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import {
		purchaseReceiptStatus,
		canEditPurchase,
		type Purchase,
		type PurchaseReceiptStatus,
		type StockLedger
	} from '../domain/operations';

	let {
		purchases,
		ledgers,
		onreceive,
		onedit
	}: {
		purchases: Purchase[];
		ledgers: StockLedger[];
		onreceive: (purchase: Purchase) => void;
		onedit: (purchase: Purchase) => void;
	} = $props();

	const STATUS_LABEL: Record<PurchaseReceiptStatus, string> = {
		not_received: 'ยังไม่รับ',
		partial: 'รับบางส่วน',
		received: 'รับครบ'
	};

	const STATUS_CLASS: Record<PurchaseReceiptStatus, string> = {
		not_received: 'bg-muted text-muted-foreground',
		partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
		received: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
	};

	// Status is always derived from the ledger — the doc has no `status` field, so
	// the badge can never drift from the balance it sits next to (CR-032 §UX 3).
	const rows = $derived(
		purchases
			.map((purchase) => ({
				purchase,
				status: purchaseReceiptStatus(purchase, ledgers),
				editable: canEditPurchase(purchase, ledgers)
			}))
			.sort((a, b) => b.purchase.occurred_at.localeCompare(a.purchase.occurred_at))
	);

	const dateFormat = new Intl.DateTimeFormat('th-TH', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	function formatDate(ts: string): string {
		const parsed = Date.parse(ts);
		return Number.isNaN(parsed) ? ts : dateFormat.format(parsed);
	}
</script>

<div class="overflow-x-auto rounded-2xl border border-border/80 bg-card shadow-sm">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="text-xs font-bold">ผู้ขาย / หน่วยงาน</Table.Head>
				<Table.Head class="text-xs font-bold">เลขใบสั่งซื้อ</Table.Head>
				<Table.Head class="text-xs font-bold">วันที่</Table.Head>
				<Table.Head class="text-right text-xs font-bold">รายการ</Table.Head>
				<Table.Head class="text-xs font-bold">สถานะการรับ</Table.Head>
				<Table.Head class="text-right text-xs font-bold">การทำงาน</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as { purchase, status, editable } (purchase._id)}
				<Table.Row>
					<Table.Cell class="font-semibold text-foreground">
						<div class="flex items-center gap-2">
							<ShoppingCart class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{purchase.vendor}</span>
						</div>
						{#if purchase.note}
							<p class="mt-0.5 truncate text-[11px] font-normal text-muted-foreground">
								{purchase.note}
							</p>
						{/if}
					</Table.Cell>
					<Table.Cell class="font-mono text-xs text-muted-foreground">
						{purchase.po_ref ?? '—'}
					</Table.Cell>
					<Table.Cell class="text-xs whitespace-nowrap text-muted-foreground">
						{formatDate(purchase.occurred_at)}
					</Table.Cell>
					<Table.Cell class="text-right font-mono text-xs">
						{purchase.items.length}
					</Table.Cell>
					<Table.Cell>
						<Badge variant="secondary" class={STATUS_CLASS[status]}>
							{STATUS_LABEL[status]}
						</Badge>
					</Table.Cell>
					<Table.Cell>
						<div class="flex justify-end gap-1.5">
							<button
								type="button"
								onclick={() => onreceive(purchase)}
								class="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90"
							>
								<PackageCheck class="h-3.5 w-3.5" />
								รับเข้าคลัง
							</button>
							{#if editable}
								<button
									type="button"
									onclick={() => onedit(purchase)}
									class="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
								>
									<Pencil class="h-3.5 w-3.5" />
									แก้ใบ
								</button>
							{/if}
						</div>
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={6} class="py-10 text-center text-sm text-muted-foreground">
						ยังไม่มีใบจัดซื้อ — กด “สร้างใบจัดซื้อ” เพื่อเริ่ม
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

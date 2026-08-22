<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useTransfers,
		useDispatchTransfer,
		useReceiveTransfer,
		useCancelTransfer
	} from '../application/queries';
	import { toast } from 'svelte-sonner';
	import type { StockTransfer, TransferStatus } from '../domain/operations';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Ban from '@lucide/svelte/icons/ban';

	const transfersQuery = useTransfers();
	const dispatchMutation = useDispatchTransfer();
	const receiveMutation = useReceiveTransfer();
	const cancelMutation = useCancelTransfer();

	const ownShelter = getShelterCode();

	const STATUS_LABEL: Record<TransferStatus, string> = {
		requested: 'รอส่งมอบ',
		shipped: 'ระหว่างขนส่ง',
		received: 'ส่งมอบสำเร็จ',
		cancelled: 'ยกเลิกแล้ว'
	};

	function isOutgoing(t: StockTransfer): boolean {
		return t.from_shelter === ownShelter;
	}

	function handleDispatch(id: string) {
		toast.promise(dispatchMutation.mutateAsync(id), {
			loading: 'กำลังอนุมัติส่งมอบ...',
			success: 'อนุมัติส่งมอบสำเร็จ',
			error: (err: unknown) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
		});
	}

	function handleReceive(t: StockTransfer) {
		// Interim UI: full receipt by default. Partial receipt (loss/damage + reason) needs
		// per-item qty editing, out of scope for this minimal round — see CR-059 field notes.
		const receivedItems = t.items.map((i) => ({ item_id: i.item_id, qty: i.qty }));
		toast.promise(receiveMutation.mutateAsync({ id: t._id, receivedItems }), {
			loading: 'กำลังยืนยันรับเข้า...',
			success: 'ยืนยันรับเข้าสำเร็จ',
			error: (err: unknown) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
		});
	}

	function handleCancel(id: string) {
		toast.promise(cancelMutation.mutateAsync(id), {
			loading: 'กำลังยกเลิกคำร้อง...',
			success: 'ยกเลิกคำร้องสำเร็จ',
			error: (err: unknown) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
		});
	}
</script>

<div class="rounded-2xl border border-border/80 bg-card p-5 shadow-md">
	<div class="mb-4 flex items-center gap-2 border-b border-border/60 pb-3">
		<Truck class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">รายการโอนย้ายข้ามศูนย์</h3>
	</div>

	{#if transfersQuery.isLoading}
		<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
	{:else if !transfersQuery.data || transfersQuery.data.length === 0}
		<p class="text-sm text-muted-foreground">ยังไม่มีรายการโอนย้าย</p>
	{:else}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>เส้นทาง</Table.Head>
					<Table.Head>รายการ</Table.Head>
					<Table.Head>สถานะ</Table.Head>
					<Table.Head class="text-right">การดำเนินการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each transfersQuery.data as t (t._id)}
					<Table.Row>
						<Table.Cell>
							<span class="font-mono text-xs font-semibold">{t.from_shelter} → {t.to_shelter}</span>
							<span
								class="ml-2 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
							>
								{isOutgoing(t) ? 'ต้นทาง (เรา)' : 'ปลายทาง (เรา)'}
							</span>
						</Table.Cell>
						<Table.Cell class="text-xs">
							{#each t.items as item (item.item_id)}
								<div>{item.item_id} — {item.qty} {item.unit}</div>
							{/each}
						</Table.Cell>
						<Table.Cell class="text-xs font-semibold">{STATUS_LABEL[t.status]}</Table.Cell>
						<Table.Cell class="text-right">
							{#if isOutgoing(t) && t.status === 'requested'}
								<button
									onclick={() => handleDispatch(t._id)}
									class={buttonVariants({ size: 'sm' })}
								>
									<Truck class="mr-1 h-3.5 w-3.5" />อนุมัติส่งมอบ
								</button>
								<button
									onclick={() => handleCancel(t._id)}
									class={buttonVariants({ size: 'sm', variant: 'outline' })}
								>
									<Ban class="mr-1 h-3.5 w-3.5" />ยกเลิก
								</button>
							{:else if !isOutgoing(t) && t.status === 'shipped'}
								<button onclick={() => handleReceive(t)} class={buttonVariants({ size: 'sm' })}>
									<PackageCheck class="mr-1 h-3.5 w-3.5" />ยืนยันรับเข้า
								</button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</div>

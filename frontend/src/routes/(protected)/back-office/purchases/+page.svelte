<script lang="ts">
	import {
		PurchaseForm,
		PurchaseReceiptForm,
		PurchaseTable,
		usePurchases,
		useStockLedgers,
		purchaseReceiptStatus,
		startOperationsLiveQuery,
		type Purchase
	} from '$lib/features/operations';
	import * as Dialog from '$lib/components/ui/dialog';
	import { useQueryClient } from '@tanstack/svelte-query';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Plus from '@lucide/svelte/icons/plus';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Pencil from '@lucide/svelte/icons/pencil';

	const queryClient = useQueryClient();

	// Reactivity comes from the PouchDB changes feed — never poll.
	$effect(() => {
		const handle = startOperationsLiveQuery(queryClient);
		return () => handle.stop();
	});

	const purchasesQuery = usePurchases();
	const ledgerQuery = useStockLedgers();

	const purchases = $derived(purchasesQuery.data ?? []);
	const ledgers = $derived(ledgerQuery.data ?? []);

	const counts = $derived.by(() => {
		const tally = { not_received: 0, partial: 0, received: 0 };
		for (const purchase of purchases) tally[purchaseReceiptStatus(purchase, ledgers)]++;
		return tally;
	});

	let isCreateOpen = $state(false);
	let receiving = $state<Purchase | null>(null);
	let editing = $state<Purchase | null>(null);
</script>

<svelte:head>
	<title>ใบจัดซื้อและการรับเข้าคลัง · SmartShelter</title>
</svelte:head>

<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<ShoppingCart class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">ใบจัดซื้อและการรับเข้าคลัง</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<p class="max-w-2xl text-xs text-muted-foreground">
			บันทึกใบจัดซื้อไว้ก่อน แล้วค่อยกดรับเข้าคลังเมื่อของมาถึง — สถานะการรับคำนวณจาก Stock Ledger
			ทุกครั้ง จึงตรงกับยอดคงเหลือเสมอ
		</p>

		<Dialog.Root bind:open={isCreateOpen}>
			<Dialog.Trigger
				class="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg transition-all duration-300 hover:bg-primary/95 hover:shadow-xl active:scale-[0.97] sm:w-auto"
			>
				<Plus class="h-4.5 w-4.5" /> สร้างใบจัดซื้อ
			</Dialog.Trigger>
			<Dialog.Content
				class="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[24px] border border-border bg-card p-6 shadow-2xl sm:max-w-2xl"
			>
				<Dialog.Header class="mb-4 border-b border-border/60 pb-4">
					<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-foreground">
						<ShoppingCart class="h-5 w-5 text-primary" />
						สร้างใบจัดซื้อ
					</Dialog.Title>
					<Dialog.Description class="mt-1 text-sm text-muted-foreground">
						บันทึกผู้ขายและรายการที่สั่ง — ของยังไม่เข้าคลังจนกว่าจะกดรับเข้าคลัง
					</Dialog.Description>
				</Dialog.Header>
				<PurchaseForm
					onsuccess={() => (isCreateOpen = false)}
					oncancel={() => (isCreateOpen = false)}
				/>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<!-- Receipt status summary — derived from the ledger, same source as the badges -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-2xl border border-border/80 bg-card/70 p-5 shadow-sm">
			<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase">
				ยังไม่รับ
			</span>
			<span class="mt-1 block text-2xl font-extrabold text-foreground">{counts.not_received}</span>
		</div>
		<div class="rounded-2xl border border-border/80 bg-card/70 p-5 shadow-sm">
			<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase">
				รับบางส่วน
			</span>
			<span class="mt-1 block text-2xl font-extrabold text-amber-600 dark:text-amber-400">
				{counts.partial}
			</span>
		</div>
		<div class="rounded-2xl border border-border/80 bg-card/70 p-5 shadow-sm">
			<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase">
				รับครบ
			</span>
			<span class="mt-1 block text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
				{counts.received}
			</span>
		</div>
	</div>

	{#if purchasesQuery.isLoading || ledgerQuery.isLoading}
		<p class="py-10 text-center text-sm text-muted-foreground">กำลังโหลดใบจัดซื้อ...</p>
	{:else}
		<PurchaseTable
			{purchases}
			{ledgers}
			onreceive={(purchase) => (receiving = purchase)}
			onedit={(purchase) => (editing = purchase)}
		/>
	{/if}
</div>

<Dialog.Root
	open={!!receiving}
	onOpenChange={(open) => {
		if (!open) receiving = null;
	}}
>
	<Dialog.Content
		class="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[24px] border border-border bg-card p-6 shadow-2xl sm:max-w-2xl"
	>
		<Dialog.Header class="mb-4 border-b border-border/60 pb-4">
			<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-foreground">
				<PackageCheck class="h-5 w-5 text-primary" />
				รับของเข้าคลัง
			</Dialog.Title>
			<Dialog.Description class="mt-1 text-sm text-muted-foreground">
				กรอกจำนวนที่นับได้จริง ระบบจะบันทึกลง Stock Ledger พร้อมอ้างอิงกลับมาที่ใบจัดซื้อนี้
			</Dialog.Description>
		</Dialog.Header>
		{#if receiving}
			{#key receiving._id}
				<PurchaseReceiptForm
					purchase={receiving}
					onsuccess={() => (receiving = null)}
					oncancel={() => (receiving = null)}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={!!editing}
	onOpenChange={(open) => {
		if (!open) editing = null;
	}}
>
	<Dialog.Content
		class="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[24px] border border-border bg-card p-6 shadow-2xl sm:max-w-2xl"
	>
		<Dialog.Header class="mb-4 border-b border-border/60 pb-4">
			<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-foreground">
				<Pencil class="h-5 w-5 text-primary" />
				แก้ไขใบจัดซื้อ
			</Dialog.Title>
			<Dialog.Description class="mt-1 text-sm text-muted-foreground">
				แก้ได้เฉพาะใบที่ยังไม่มีการรับของ — เมื่อเริ่มรับแล้วรายการที่สั่งจะถูกล็อกไว้เป็นฐานเทียบ
			</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			{#key editing._id}
				<PurchaseForm
					purchase={editing}
					onsuccess={() => (editing = null)}
					oncancel={() => (editing = null)}
				/>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import {
		useFuelCylinders,
		useGasLedger,
		gasCylinderBalance,
		gasCylinderStatus,
		type FuelCylinder,
		type GasCylinderStatus
	} from '$lib/features/kitchen';

	const fuelCylinders = useFuelCylinders();
	const gasLedger = useGasLedger();

	const GAS_STATUS_LABELS: Record<GasCylinderStatus, string> = {
		unused: 'ยังไม่ใช้',
		in_use: 'กำลังใช้',
		empty: 'หมดแล้ว'
	};
	const GAS_STATUS_CLASS: Record<GasCylinderStatus, string> = {
		unused: 'border-border bg-muted text-muted-foreground',
		in_use:
			'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
		empty:
			'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
	};

	// Compute remaining gas balance from ledger.
	function remainingOf(g: FuelCylinder): string {
		return gasCylinderBalance(gasLedger.data ?? [], g._id, g.capacity_kg);
	}

	// Deactivated cylinders are retired/broken — hidden from this overview (CR-120 FR-15).
	const gasList = $derived((fuelCylinders.data ?? []).filter((g) => !g.deactivated));

	const stats = $derived.by(() => {
		const ledger = gasLedger.data ?? [];
		let inUseCount = 0;
		let unusedCount = 0;
		let emptyCount = 0;
		let totalRemaining = 0;
		let totalCapacity = 0;

		for (const g of gasList) {
			const remStr = gasCylinderBalance(ledger, g._id, g.capacity_kg);
			const rem = parseFloat(remStr) || 0;
			const cap = parseFloat(g.capacity_kg) || 0;
			const st = gasCylinderStatus(remStr, g.capacity_kg);
			if (st === 'in_use') inUseCount++;
			else if (st === 'empty') emptyCount++;
			else unusedCount++;

			totalRemaining += rem;
			totalCapacity += cap;
		}

		const totalUsed = Math.max(0, totalCapacity - totalRemaining);

		return {
			totalTypes: gasList.length,
			inUseCount,
			unusedCount,
			emptyCount,
			totalRemaining: totalRemaining.toFixed(1),
			totalUsed: totalUsed.toFixed(1)
		};
	});
</script>

<div class="mx-auto space-y-6 p-4">
	<!-- Top Navigation Breadcrumb & Header -->
	<div class="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
		<div class="flex items-center gap-3">
			<Button
				variant="outline"
				size="icon"
				href={resolve('/back-office/kitchen')}
				aria-label="กลับสู่ครัวกลาง"
			>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div
				class="rounded-lg bg-orange-100 p-2 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
			>
				<Flame class="h-5 w-5" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-base font-bold text-foreground sm:text-lg">ภาพรวมถังแก๊สสำหรับโรงครัว</h1>
					<Badge variant="outline" class="font-normal text-muted-foreground">
						{gasList.length} ถัง
					</Badge>
				</div>
				<p class="text-xs text-muted-foreground">
					มุมมองอ่านอย่างเดียว — เพิ่ม/แก้ไข/เติม/ตัดเศษ/ปลดระวางถังแก๊สที่หน้าคลังสินค้า
				</p>
			</div>
		</div>

		<Button
			href={resolve('/back-office/catalog') +
				'?tab=item_master&category=item_category%3Afuel_energy'}
			variant="outline"
			class="gap-1.5"
		>
			จัดการเชื้อเพลิงและพลังงานที่คลังสินค้า
			<ArrowRight class="h-4 w-4" />
		</Button>
	</div>

	<!-- Stats Summary KPIs -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ถังแก๊สทั้งหมด</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-foreground">{stats.totalTypes}</p>
			<p class="mt-0.5 text-xs text-muted-foreground">ถังที่ลงทะเบียน (ไม่รวมปลดระวาง)</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">สถานะการใช้งาน</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-foreground">
				<span class="text-blue-600 dark:text-blue-400">{stats.inUseCount}</span>
				<span class="text-sm font-normal text-muted-foreground">/ {stats.totalTypes} กำลังใช้</span>
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">ยังไม่ใช้ {stats.unusedCount} ถัง</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ปริมาณแก๊สคงเหลือรวม</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
				{stats.totalRemaining}
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">กิโลกรัม (kg)</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ปริมาณแก๊สที่ใช้ไปรวม</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
				{stats.totalUsed}
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">กิโลกรัม (kg)</p>
		</div>
	</div>

	<!-- Read-only cylinder table -->
	<Card.Root class="border shadow-sm">
		<Card.Header class="border-b pb-4">
			<div class="flex items-center gap-2">
				<Card.Title class="text-base font-semibold">ถังแก๊สประจำศูนย์</Card.Title>
				<Badge variant="secondary" class="font-mono">{gasList.length}</Badge>
			</div>
			<Card.Description class="text-xs">
				ยอดคงเหลือคำนวณจากประวัติการใช้/เติมแก๊สล่าสุด (gas_ledger) — จัดการถังได้ที่หน้าคลังสินค้า
			</Card.Description>
		</Card.Header>
		<Card.Content class="p-0">
			{#if fuelCylinders.isPending}
				<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</div>
			{:else if !gasList.length}
				<div class="py-12 text-center text-sm text-muted-foreground">
					ยังไม่มีถังแก๊สลงทะเบียน — เพิ่มได้ที่หน้าคลังสินค้า
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row class="bg-muted/40 hover:bg-muted/40">
								<Table.Head class="font-semibold">รหัสถัง</Table.Head>
								<Table.Head class="font-semibold">ชื่อ/ป้ายระบุ</Table.Head>
								<Table.Head class="text-right font-semibold">ความจุต่อถัง (kg)</Table.Head>
								<Table.Head class="text-right font-semibold">Burn Rate (kg/ชม.)</Table.Head>
								<Table.Head class="text-center font-semibold">สถานะ</Table.Head>
								<Table.Head class="min-w-[140px] font-semibold">ระดับคงเหลือ (%)</Table.Head>
								<Table.Head class="text-right font-semibold">คงเหลือ</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each gasList as g (g._id)}
								{@const remaining = remainingOf(g)}
								{@const status = gasCylinderStatus(remaining, g.capacity_kg)}
								{@const capNum = parseFloat(g.capacity_kg) || 1}
								{@const remNum = parseFloat(remaining) || 0}
								{@const pct = Math.max(0, Math.min(100, Math.round((remNum / capNum) * 100)))}
								<Table.Row>
									<Table.Cell class="font-mono text-xs">{g.cylinder_code}</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-2">
											<div
												class="rounded-md bg-orange-50 p-1.5 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
											>
												<Flame class="h-3.5 w-3.5 shrink-0" />
											</div>
											<span class="font-medium text-foreground">{g.name}</span>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right font-mono">{g.capacity_kg} kg</Table.Cell>
									<Table.Cell class="text-right font-mono text-blue-600 dark:text-blue-400">
										{g.burn_rate_kg_per_hour} kg/ชม.
									</Table.Cell>
									<Table.Cell class="text-center">
										<Badge variant="outline" class={GAS_STATUS_CLASS[status]}>
											{GAS_STATUS_LABELS[status]}
										</Badge>
									</Table.Cell>
									<Table.Cell class="min-w-[140px]">
										<div class="flex items-center gap-2">
											<div class="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
												<div
													class="h-full rounded-full transition-all duration-300 {pct > 50
														? 'bg-emerald-500'
														: pct > 20
															? 'bg-amber-500'
															: 'bg-red-500'}"
													style="width: {pct}%"
												></div>
											</div>
											<span
												class="w-9 shrink-0 text-right font-mono text-xs font-semibold {pct > 50
													? 'text-emerald-600 dark:text-emerald-400'
													: pct > 20
														? 'text-amber-600 dark:text-amber-400'
														: 'text-red-600 dark:text-red-400'}"
											>
												{pct}%
											</span>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right font-mono font-semibold text-foreground">
										{remaining} kg
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

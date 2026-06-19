<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Package from '@lucide/svelte/icons/package';
	import Scale from '@lucide/svelte/icons/scale';
	import Flame from '@lucide/svelte/icons/flame';
	import Clock from '@lucide/svelte/icons/clock';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Plus from '@lucide/svelte/icons/plus';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useEvacuees } from '$lib/features/people';
	import { useProductionLogs, shortCode, STATUS_CONFIG } from '$lib/features/kitchen';

	const evacueeQuery = useEvacuees();
	const logsQuery = useProductionLogs();

	const evacueeCount = $derived(evacueeQuery.data?.length ?? 0);
	const logs = $derived(logsQuery.data ?? []);

	const totalBoxes = $derived(logs.reduce((sum, l) => sum + l.boxes, 0));
	const totalWeightKg = $derived(logs.reduce((sum, l) => sum + l.weight_kg, 0));
	const latestLog = $derived(logs.at(-1));
	const stovesUsed = $derived(latestLog?.stoves_used ?? 0);
	const stovesTotal = $derived(latestLog?.stoves_total ?? 4);
	const totalMinutes = $derived(logs.reduce((sum, l) => sum + (l.estimated_minutes ?? 0), 0));

	const isOffline = $derived(authStore.needsReauth);
</script>

<svelte:head>
	<title>ครัวกลางและอาหาร · SmartShelter</title>
</svelte:head>

<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<UtensilsCrossed class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">ครัวกลางและอาหาร</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4">
	{#if isOffline}
		<div class="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
			<span class="font-semibold">Offline Mode:</span>
			ระบบไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ ข้อมูลจะเก็บไว้ในเครื่องของท่านในขณะนี้ ข้อมูลจะถูกส่งเมื่อกลับมาออนไลน์
		</div>
	{/if}

	<!-- Meal Production Logs header card -->
	<div class="rounded-xl border border-border bg-card p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div class="flex items-start gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
				>
					<ChefHat class="h-5 w-5" />
				</div>
				<div>
					<h2 class="text-sm font-bold text-foreground">
						ประวัติประกอบเสบียงโรงครัว (Meal Production Logs)
					</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						บันทึกประวัติการประกอบอาหารผู้พักพิง ศูนย์พักพิง ตามมาตรฐานโรงครัว
						ระบบออฟไลน์จะรองรับการบันทึกเมื่อไม่มีอินเทอร์เน็ต
					</p>
				</div>
			</div>

			<div class="flex shrink-0 flex-wrap items-center gap-2">
				<div
					class="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5"
				>
					<span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
					<span class="text-xs font-medium text-green-700">
						<span class="font-bold">{evacueeCount.toLocaleString()}</span> คน
					</span>
					<span class="text-[10px] text-green-600/70">ผู้พักอาศัย (LIVE COUNT)</span>
				</div>

				<Button variant="outline" size="sm" onclick={() => toast.info('เร็วๆ นี้')}>
					ข้อแนะนำ ({logs.length})
				</Button>

				<Button variant="outline" size="sm" onclick={() => toast.info('เร็วๆ นี้')}>
					<BookOpen class="h-3.5 w-3.5" />
					ฐานสูตร BOM
				</Button>
			</div>
		</div>
	</div>

	<!-- Stats row -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl border border-border bg-card p-4">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<Package class="h-3.5 w-3.5" />
				กล่องอาหารสำหรับมื้อนี้
			</div>
			<p class="mt-2 text-2xl font-bold text-foreground">
				{totalBoxes.toLocaleString()}
				<span class="text-sm font-normal text-muted-foreground">กล่อง</span>
			</p>
		</div>

		<div class="rounded-xl border border-border bg-card p-4">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<Scale class="h-3.5 w-3.5" />
				น้ำหนักรวมวัตถุดิบ
			</div>
			<p class="mt-2 text-2xl font-bold text-foreground">
				{totalWeightKg.toFixed(2)}
				<span class="text-sm font-normal text-muted-foreground">กก.</span>
			</p>
		</div>

		<div class="rounded-xl border border-border bg-card p-4">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<Flame class="h-3.5 w-3.5" />
				เตาประกอบพร้อม/ทั้งหมด
			</div>
			<p class="mt-2 text-2xl font-bold text-foreground">
				{stovesUsed} / {stovesTotal}
				<span class="text-sm font-normal text-muted-foreground">หัว</span>
			</p>
		</div>

		<div class="rounded-xl border border-border bg-card p-4">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<Clock class="h-3.5 w-3.5" />
				เวลาสะสมประกอบเมนู
			</div>
			<p class="mt-2 text-2xl font-bold text-foreground">
				~{totalMinutes}
				<span class="text-sm font-normal text-muted-foreground">นาที</span>
			</p>
		</div>
	</div>

	<!-- Production logs table -->
	<div class="flex flex-col gap-3">
		<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="flex items-center gap-2">
					<ChefHat class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">
						ตารางประวัติกิจกรรมประกอบอาหารภัยพิบัติ ({logs.length} รายการ)
					</h3>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					แสดงเฉพาะกิจกรรมล่าสุดที่บันทึกในวันนี้เท่านั้นสำหรับมื้ออาหารและหลักฐาน
				</p>
			</div>
			<Button size="sm" onclick={() => toast.info('เร็วๆ นี้')}>
				<Plus class="h-3.5 w-3.5" />
				จัดการรายการอาหารใหม่
			</Button>
		</div>

		{#if logsQuery.isLoading}
			<p class="text-sm text-muted-foreground">Loading...</p>
		{:else if logsQuery.isError}
			<p class="text-sm text-destructive">Error: {logsQuery.error?.message}</p>
		{:else if logs.length === 0}
			<div class="rounded-xl border border-border bg-card p-10 text-center">
				<UtensilsCrossed class="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
				<p class="text-sm font-medium text-muted-foreground">ยังไม่มีรายการประกอบอาหาร</p>
				<p class="mt-1 text-xs text-muted-foreground/70">
					กด "จัดการรายการอาหารใหม่" เพื่อเริ่มบันทึก
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>รหัส / เวลาเริ่ม</Table.Head>
							<Table.Head>ตัวเลือกเมนูอาหาร</Table.Head>
							<Table.Head>ปริมาณผลผลิต</Table.Head>
							<Table.Head>สถานะ</Table.Head>
							<Table.Head class="text-center">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each logs as log (log._id)}
							{@const cfg = STATUS_CONFIG[log.status]}
							<Table.Row>
								<Table.Cell>
									<p class="font-mono text-xs font-bold text-foreground">{shortCode(log)}</p>
									<p class="text-xs text-muted-foreground">
										{new Date(log.started_at).toLocaleString('th-TH', {
											day: '2-digit',
											month: '2-digit',
											year: 'numeric',
											hour: '2-digit',
											minute: '2-digit'
										})} น.
									</p>
								</Table.Cell>
								<Table.Cell>
									<p class="font-medium text-foreground">{log.menu}</p>
									{#if log.sub_note}
										<p class="mt-0.5 text-xs text-muted-foreground">{log.sub_note}</p>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<span class="font-bold text-foreground">
										{log.boxes.toLocaleString()}
									</span>
									<span class="text-xs text-muted-foreground"> กล่อง</span>
								</Table.Cell>
								<Table.Cell>
									<span class="rounded-full px-2.5 py-1 text-xs font-medium {cfg.className}">
										{cfg.label}
									</span>
								</Table.Cell>
								<Table.Cell class="text-center">
									<Button variant="outline" size="sm" onclick={() => toast.info('เร็วๆ นี้')}>
										เปิดดูข้อมูล
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</div>
</div>

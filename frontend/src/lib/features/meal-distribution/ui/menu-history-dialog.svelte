<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import History from '@lucide/svelte/icons/history';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Utensils from '@lucide/svelte/icons/utensils';
	import { getMealsStore } from '../application/meal-distribution-store.svelte';
	import {
		quotaPercent,
		remainingPortions,
		type MealDistributionTransaction
	} from '../domain/meal-distribution';

	const store = getMealsStore();
	const menu = $derived(store.historyTargetMenu);
	const historyLogs = $derived(menu ? store.getHistoryTransactions(menu.id) : []);

	let voidTarget = $state<MealDistributionTransaction | null>(null);

	function handleOpenKioskFromHistory() {
		if (!menu) return;
		const target = menu;
		store.closeMenuHistory();
		store.startKiosk(target);
	}

	function handleConfirmVoid() {
		if (!voidTarget) return;
		store.voidTransaction(voidTarget.id);
		voidTarget = null;
	}
</script>

<Dialog.Root
	open={menu !== null}
	onOpenChange={(open) => {
		if (!open) store.closeMenuHistory();
	}}
>
	<Dialog.Content
		class="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-2xl"
	>
		{#if menu}
			<!-- Dialog Header -->
			<div class="relative border-b border-slate-100 bg-slate-50/60 p-6 pr-12">
				<div class="flex items-start gap-4">
					<div
						class="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-amber-200/80 bg-amber-50 text-amber-600 shadow-xs"
					>
						<History class="size-6" />
					</div>
					<div class="min-w-0 flex-1 space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="text-lg font-black tracking-tight text-slate-900">
								{menu.title}
							</h3>
							<Badge
								variant="outline"
								class="border-none text-xs font-extrabold tracking-wide uppercase {menu.status ===
								'ready'
									? 'bg-emerald-100 text-emerald-800'
									: 'bg-slate-200 text-slate-700'}"
							>
								{menu.status === 'ready' ? 'เปิดแจกอยู่' : 'ปิดรอบแล้ว'}
							</Badge>
						</div>
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
							<span class="inline-flex items-center gap-1 font-mono font-bold text-slate-700">
								🏷️ {menu.batchCode}
							</span>
							<span>•</span>
							<span class="inline-flex items-center gap-1">
								<Clock class="size-3 text-slate-400" />
								<span>ปรุงเสร็จ: {menu.cookTime}</span>
							</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Body Content -->
			<div class="flex-1 space-y-5 overflow-y-auto p-6">
				<!-- KPI Summary Cards -->
				<div class="grid grid-cols-3 gap-3">
					<div class="rounded-2xl border border-slate-200/80 bg-slate-50 p-3.5 text-center">
						<span class="block text-xs font-extrabold tracking-wider text-slate-400 uppercase">
							เป้าหมายปรุงเสร็จ
						</span>
						<div class="mt-1 text-lg font-black text-slate-900">
							{menu.target} <span class="text-xs font-semibold text-slate-500">ที่</span>
						</div>
					</div>

					<div class="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-3.5 text-center">
						<span class="block text-xs font-extrabold tracking-wider text-emerald-700 uppercase">
							แจกจ่ายสำเร็จ
						</span>
						<div class="mt-1 text-lg font-black text-emerald-700">
							{menu.served}
							<span class="text-xs font-bold text-emerald-600/80"
								>({quotaPercent(menu.served, menu.target)}%)</span
							>
						</div>
					</div>

					<div class="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-3.5 text-center">
						<span class="block text-xs font-extrabold tracking-wider text-amber-800 uppercase">
							คงเหลือ / บูดทิ้ง
						</span>
						<div class="mt-1 text-lg font-black text-amber-800">
							{remainingPortions(menu)} <span class="text-xs font-semibold opacity-80">ที่</span>
						</div>
					</div>
				</div>

				{#if menu.closedNote}
					<div
						class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900"
					>
						<AlertCircle class="mt-0.5 size-4 shrink-0 text-amber-600" />
						<div class="space-y-0.5">
							<span class="font-extrabold">หมายเหตุการปิดรอบ:</span>
							<p class="leading-relaxed text-amber-800">{menu.closedNote}</p>
						</div>
					</div>
				{/if}

				<!-- Transaction Audit Trail Table -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<h4 class="text-xs font-extrabold tracking-wider text-slate-500 uppercase">
							ประวัติการบันทึกแจกรายบุคคล (AUDIT TRAIL • CR-109)
						</h4>
						<div class="flex items-center gap-2">
							{#if historyLogs.some((l) => l.status === 'voided')}
								<Badge
									variant="outline"
									class="border-rose-200 bg-rose-50 text-xs font-bold text-rose-700"
								>
									ยกเลิกแล้ว {historyLogs.filter((l) => l.status === 'voided').length} รายการ
								</Badge>
							{/if}
							<Badge variant="secondary" class="font-mono text-xs font-bold">
								{historyLogs.length} รายการ
							</Badge>
						</div>
					</div>

					{#if historyLogs.length === 0}
						<div
							class="flex flex-col items-center justify-center space-y-2 rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400"
						>
							<Clock class="size-8 opacity-45" />
							<p class="text-xs font-bold text-slate-600">
								ยังไม่มีประวัติการบันทึกแจกสำหรับเมนูนี้
							</p>
							<p class="text-xs text-slate-400">
								รายการแจกจ่ายจะบันทึกอัตโนมัติเมื่อเจ้าหน้าที่ยืนยันแจกจ่ายในจุด Kiosk
							</p>
						</div>
					{:else}
						<div class="overflow-hidden rounded-2xl border border-slate-200">
							<table class="w-full text-left text-xs">
								<thead
									class="border-b border-slate-200 bg-slate-50/80 font-bold tracking-wider text-slate-500 uppercase"
								>
									<tr>
										<th class="p-3.5 pl-4">ผู้รับอาหาร</th>
										<th class="p-3.5 text-center">เตียง / โซน</th>
										<th class="p-3.5 text-center">เวลาแจก</th>
										<th class="p-3.5 text-center">สถานะ</th>
										<th class="p-3.5 text-right">จำนวน</th>
										<th class="p-3.5 pr-4 text-center">การจัดการ</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100 text-slate-800">
									{#each historyLogs as log (log.id)}
										<tr
											class="transition-colors hover:bg-slate-50/80 {log.status === 'voided'
												? 'bg-slate-50/40 opacity-60'
												: ''}"
										>
											<td class="p-3.5 pl-4 align-middle font-bold">
												<div class="flex items-center gap-2.5">
													<div
														class="flex size-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200"
													>
														<User class="size-3.5" />
													</div>
													<span
														class="text-slate-900 {log.status === 'voided'
															? 'text-slate-400 line-through'
															: ''}">{log.recipientName}</span
													>
												</div>
											</td>
											<td class="p-3.5 text-center align-middle font-mono font-bold text-slate-600">
												<span class="rounded-md bg-slate-100 px-2 py-0.5 text-xs">
													{log.bed}
												</span>
											</td>
											<td class="p-3.5 text-center align-middle text-slate-500">
												{log.time}
											</td>
											<td class="p-3.5 text-center align-middle">
												{#if log.status === 'voided'}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700"
													>
														ยกเลิกแล้ว (Voided)
													</span>
												{:else}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700"
													>
														ปกติ
													</span>
												{/if}
											</td>
											<td class="p-3.5 text-right align-middle">
												<span
													class="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-black {log.status ===
													'voided'
														? 'text-slate-400 line-through'
														: 'bg-emerald-50 text-emerald-700'}"
												>
													{#if log.status !== 'voided'}
														<CheckCircle2 class="size-3 text-emerald-600" />
													{/if}
													+{log.portions} ชุด
												</span>
											</td>
											<td class="p-3.5 pr-4 text-center align-middle">
												{#if log.status === 'active'}
													<Button
														variant="outline"
														size="sm"
														onclick={() => (voidTarget = log)}
														class="h-7 border-rose-200 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700"
													>
														ยกเลิกรายการ
													</Button>
												{:else}
													<span class="text-xs text-slate-400">
														{log.voided_at || log.voidedAt
															? `เมื่อ ${log.voided_at || log.voidedAt}`
															: '—'}
													</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>

			<!-- Dialog Footer -->
			<div class="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 p-4">
				<Button
					variant="outline"
					size="sm"
					onclick={handleOpenKioskFromHistory}
					class="gap-1.5 rounded-xl border-amber-200 bg-amber-50 text-xs font-bold text-amber-900 hover:bg-amber-100"
				>
					<Utensils class="size-3.5 text-amber-600" />
					<span>เปิดใน Kiosk Panel (เต็มจอ)</span>
					<ExternalLink class="size-3 opacity-60" />
				</Button>

				<Button
					variant="secondary"
					size="sm"
					onclick={() => store.closeMenuHistory()}
					class="rounded-xl px-5 text-xs font-bold"
				>
					ปิดหน้าต่าง
				</Button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Alert Dialog for Void Confirmation (Replacing browser confirm) -->
<AlertDialog.Root
	open={voidTarget !== null}
	onOpenChange={(open) => {
		if (!open) voidTarget = null;
	}}
>
	<AlertDialog.Content class="rounded-2xl">
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการยกเลิกรายการแจกจ่าย (Void Transaction)</AlertDialog.Title>
			<AlertDialog.Description>
				{#if voidTarget}
					คุณต้องการยกเลิกรายการแจกจ่ายอาหารของ <strong>{voidTarget.recipientName}</strong> (เตียง {voidTarget.bed})
					จำนวน {voidTarget.portions} ชุด หรือไม่?
					<br /><br />
					ยอดแจกจ่ายของเมนูนี้จะถูกปรับลดย้อนกลับทันทีตามข้อกำหนด CR-109 และระบบจะบันทึกประวัติการยกเลิกไว้ใน
					Audit Trail
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (voidTarget = null)}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-rose-600 text-white hover:bg-rose-700"
				onclick={handleConfirmVoid}
			>
				ยืนยันยกเลิกรายการ (Void)
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

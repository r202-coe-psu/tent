<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
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
	import { quotaPercent, remainingPortions } from '../domain/meal-distribution';

	const store = getMealsStore();
	const menu = $derived(store.historyTargetMenu);
	const historyLogs = $derived(menu ? store.getHistoryTransactions(menu.id) : []);

	function handleOpenKioskFromHistory() {
		if (!menu) return;
		const target = menu;
		store.closeMenuHistory();
		store.startKiosk(target);
	}
</script>

<Dialog.Root
	open={menu !== null}
	onOpenChange={(open) => {
		if (!open) store.closeMenuHistory();
	}}
>
	<Dialog.Content
		class="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-2xl dark:border-zinc-800 dark:bg-zinc-950"
	>
		{#if menu}
			<!-- Dialog Header -->
			<div
				class="relative border-b border-slate-100 bg-slate-50/60 p-6 pr-12 dark:border-zinc-800/80 dark:bg-zinc-900/50"
			>
				<div class="flex items-start gap-4">
					<div
						class="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-amber-200/80 bg-amber-50 text-amber-600 shadow-xs dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-400"
					>
						<History class="size-6" />
					</div>
					<div class="min-w-0 flex-1 space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="text-lg font-black tracking-tight text-slate-900 dark:text-white">
								{menu.title}
							</h3>
							<Badge
								variant="outline"
								class="border-none text-[10px] font-extrabold tracking-wide uppercase {menu.status ===
								'ready'
									? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
									: 'bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300'}"
							>
								{menu.status === 'ready' ? 'เปิดแจกอยู่' : 'ปิดรอบแล้ว'}
							</Badge>
						</div>
						<div
							class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-zinc-400"
						>
							<span
								class="inline-flex items-center gap-1 font-mono font-bold text-slate-700 dark:text-zinc-300"
							>
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
					<div
						class="rounded-2xl border border-slate-200/80 bg-slate-50 p-3.5 text-center dark:border-zinc-800 dark:bg-zinc-900/40"
					>
						<span
							class="block text-[10px] font-extrabold tracking-wider text-slate-400 uppercase dark:text-zinc-500"
						>
							เป้าหมายปรุงเสร็จ
						</span>
						<div class="mt-1 text-lg font-black text-slate-900 dark:text-white">
							{menu.target} <span class="text-xs font-semibold text-slate-500">ที่</span>
						</div>
					</div>

					<div
						class="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-3.5 text-center dark:border-emerald-900/30 dark:bg-emerald-950/20"
					>
						<span
							class="block text-[10px] font-extrabold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
						>
							แจกจ่ายสำเร็จ
						</span>
						<div class="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-400">
							{menu.served}
							<span class="text-xs font-bold text-emerald-600/80"
								>({quotaPercent(menu.served, menu.target)}%)</span
							>
						</div>
					</div>

					<div
						class="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-3.5 text-center dark:border-amber-900/30 dark:bg-amber-950/20"
					>
						<span
							class="block text-[10px] font-extrabold tracking-wider text-amber-800 uppercase dark:text-amber-400"
						>
							คงเหลือ / บูดทิ้ง
						</span>
						<div class="mt-1 text-lg font-black text-amber-800 dark:text-amber-400">
							{remainingPortions(menu)} <span class="text-xs font-semibold opacity-80">ที่</span>
						</div>
					</div>
				</div>

				{#if menu.closedNote}
					<div
						class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
					>
						<AlertCircle class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
						<div class="space-y-0.5">
							<span class="font-extrabold">หมายเหตุการปิดรอบ:</span>
							<p class="leading-relaxed text-amber-800 dark:text-amber-300">{menu.closedNote}</p>
						</div>
					</div>
				{/if}

				<!-- Transaction Audit Trail Table -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<h4
							class="text-xs font-extrabold tracking-wider text-slate-500 uppercase dark:text-zinc-400"
						>
							ประวัติการบันทึกแจกรายบุคคล (AUDIT TRAIL • CR-109)
						</h4>
						<div class="flex items-center gap-2">
							{#if historyLogs.some((l) => l.status === 'voided')}
								<Badge
									variant="outline"
									class="border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700"
								>
									ยกเลิกแล้ว {historyLogs.filter((l) => l.status === 'voided').length} รายการ
								</Badge>
							{/if}
							<Badge variant="secondary" class="font-mono text-[10px] font-bold">
								{historyLogs.length} รายการ
							</Badge>
						</div>
					</div>

					{#if historyLogs.length === 0}
						<div
							class="flex flex-col items-center justify-center space-y-2 rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400 dark:border-zinc-800"
						>
							<Clock class="size-8 opacity-40" />
							<p class="text-xs font-bold text-slate-600 dark:text-zinc-400">
								ยังไม่มีประวัติการบันทึกแจกสำหรับเมนูนี้
							</p>
							<p class="text-[11px] text-slate-400">
								รายการแจกจ่ายจะบันทึกอัตโนมัติเมื่อเจ้าหน้าที่ยืนยันแจกจ่ายในจุด Kiosk
							</p>
						</div>
					{:else}
						<div class="overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800">
							<table class="w-full text-left text-xs">
								<thead
									class="border-b border-slate-200 bg-slate-50/80 font-bold tracking-wider text-slate-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400"
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
								<tbody
									class="divide-y divide-slate-100 text-slate-800 dark:divide-zinc-800/60 dark:text-slate-200"
								>
									{#each historyLogs as log (log.id)}
										<tr
											class="transition-colors hover:bg-slate-50/80 dark:hover:bg-zinc-900/50 {log.status ===
											'voided'
												? 'bg-slate-50/40 opacity-60'
												: ''}"
										>
											<td class="p-3.5 pl-4 align-middle font-bold">
												<div class="flex items-center gap-2.5">
													<div
														class="flex size-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-zinc-800 dark:text-slate-300 dark:ring-zinc-700"
													>
														<User class="size-3.5" />
													</div>
													<span
														class="text-slate-900 dark:text-white {log.status === 'voided'
															? 'text-slate-400 line-through'
															: ''}">{log.recipientName}</span
													>
												</div>
											</td>
											<td
												class="p-3.5 text-center align-middle font-mono font-bold text-slate-600 dark:text-zinc-400"
											>
												<span
													class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800"
												>
													{log.bed}
												</span>
											</td>
											<td class="p-3.5 text-center align-middle text-slate-500 dark:text-zinc-400">
												{log.time}
											</td>
											<td class="p-3.5 text-center align-middle">
												{#if log.status === 'voided'}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700"
													>
														ยกเลิกแล้ว (Voided)
													</span>
												{:else}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
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
														: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}"
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
														onclick={() => {
															if (
																confirm(
																	`ยืนยันการยกเลิกรายการแจกจ่าย (Void) ของ "${log.recipientName}" หรือไม่?\nยอดแจกจะถูกปรับลดลงทันทีตาม CR-109`
																)
															) {
																store.voidTransaction(log.id);
															}
														}}
														class="h-7 border-rose-200 px-2.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:hover:bg-rose-950/30"
													>
														ยกเลิกรายการ
													</Button>
												{:else}
													<span class="text-[10px] text-slate-400">
														{log.voided_at ? `เมื่อ ${log.voided_at}` : '—'}
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
			<div
				class="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 p-4 dark:border-zinc-800/80 dark:bg-zinc-900/50"
			>
				<Button
					variant="outline"
					size="sm"
					onclick={handleOpenKioskFromHistory}
					class="gap-1.5 rounded-xl border-amber-200 bg-amber-50 text-xs font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50"
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

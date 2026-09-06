<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Search from '@lucide/svelte/icons/search';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Camera from '@lucide/svelte/icons/camera';
	import X from '@lucide/svelte/icons/x';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { getMealsStore } from '../application/meal-distribution-store.svelte';

	const store = getMealsStore();
	const menu = $derived(store.activeKioskMenu!);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (store.selectedRecipient) {
				e.preventDefault();
				store.deselectRecipient();
			}
		} else if (e.key === 'Enter') {
			if (store.selectedRecipient) {
				if (!store.selectedRecipientAlreadyServed) {
					e.preventDefault();
					store.confirmServe();
				}
			} else if (store.searchResults.length === 1) {
				e.preventDefault();
				store.selectRecipient(store.searchResults[0]);
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-6">
	<!-- Kiosk info banner -->
	<div
		class="flex flex-col gap-3 rounded-xl border border-[#fef08a] bg-[#fef9c3] p-4 shadow-sm md:flex-row md:items-center md:justify-between dark:border-amber-900/30 dark:bg-amber-950/20"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex size-8 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-white shadow"
			>
				<QrCode class="size-4" />
			</div>
			<div>
				<h3 class="text-sm font-extrabold text-amber-950 dark:text-amber-300">
					{menu.title}
				</h3>
				<p class="text-[10px] text-amber-800 dark:text-amber-400">
					{menu.batchCode} • ผู้รับเป้าหมาย: {menu.tags.join(', ')}
				</p>
			</div>
		</div>

		<Badge
			variant="outline"
			class="w-fit gap-1.5 border-emerald-200 bg-emerald-100 text-xs font-extrabold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 {menu.status ===
			'closed'
				? 'border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
				: ''}"
		>
			<span
				class="size-1.5 rounded-full {menu.status === 'closed' ? 'bg-rose-500' : 'bg-emerald-500'}"
			></span>
			<span
				>{menu.status === 'closed' ? 'ปิดรอบแล้ว' : 'แจกเข้า'}: {menu.served} / {menu.target} ที่</span
			>
		</Badge>
	</div>

	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
		<!-- Left: scan / search -->
		<div class="space-y-4 lg:col-span-7">
			<div
				class="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="flex items-center justify-between">
					<h4
						class="flex items-center gap-1.5 text-sm font-extrabold text-slate-800 dark:text-white"
					>
						<Search class="size-4" />
						<span>สแกน QR หรือ ค้นหาผู้รับอาหาร</span>
					</h4>

					<Button
						variant="outline"
						size="sm"
						onclick={() => (store.isScannerOpen = true)}
						class="gap-1.5 text-xs font-bold"
					>
						<Camera class="size-3.5 text-slate-500" />
						<span>กล้องสแกน QR</span>
					</Button>
				</div>

				<div class="relative">
					<Search class="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-slate-400" />
					<Input
						type="text"
						placeholder="พิมพ์ชื่อ, เลขบัตร 13 หลัก, เบอร์โทร, หรือสแกน QR..."
						bind:value={store.searchQuery}
						class="h-12 rounded-xl border-2 border-amber-500/80 pl-12 text-sm font-medium focus-visible:border-amber-600 focus-visible:ring-amber-500"
					/>
					{#if store.searchQuery}
						<button
							onclick={() => (store.searchQuery = '')}
							aria-label="ล้างคำค้นหา"
							class="absolute top-1/2 right-4 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
						>
							<X class="size-3.5" />
						</button>
					{/if}
				</div>

				{#if store.selectedRecipient}
					{@const recipient = store.selectedRecipient}
					<div
						class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="flex items-center gap-3">
								<div
									class="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-lg font-bold text-white"
								>
									{recipient.name.charAt(0)}
								</div>
								<div>
									<div class="text-sm font-bold text-slate-900 dark:text-white">
										{recipient.name}
									</div>
									<div class="text-[11px] text-slate-400">
										รหัส: {recipient.id} | โซน: {recipient.zone} | เตียง: {recipient.bed}
									</div>
								</div>
							</div>
							<button
								onclick={() => store.deselectRecipient()}
								aria-label="ยกเลิกการเลือก"
								class="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
							>
								<X class="size-4" />
							</button>
						</div>

						<div
							class="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/30"
						>
							<div>
								<div class="text-xs font-bold text-slate-700 dark:text-slate-300">
									จำนวนที่รับ: <span class="text-amber-600">{store.servePortions} ที่</span>
								</div>
								<p class="text-[10px] text-slate-400">ปรับจำนวนหากรับแทนสมาชิกในครอบครัว</p>
							</div>
							<div class="flex items-center gap-2">
								<button
									onclick={() => store.setServePortions(store.servePortions - 1)}
									aria-label="ลดจำนวน"
									class="flex size-7 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800"
								>
									<Minus class="size-3.5" />
								</button>
								<span class="w-6 text-center text-sm font-bold text-slate-900 dark:text-white"
									>{store.servePortions}</span
								>
								<button
									onclick={() => store.setServePortions(store.servePortions + 1)}
									aria-label="เพิ่มจำนวน"
									class="flex size-7 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800"
								>
									<Plus class="size-3.5" />
								</button>
							</div>
						</div>

						{#if store.selectedRecipientAlreadyServed}
							<div
								class="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center text-xs font-bold text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20"
							>
								ผู้ประสบภัยรายนี้รับประทานเมนูนี้ไปแล้ว
							</div>
						{:else}
							{#if store.selectedRecipientMismatch}
								<div
									class="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center dark:border-amber-900/40 dark:bg-amber-950/20"
								>
									<AlertTriangle class="mx-auto size-5 text-amber-600" />
									<h5 class="text-sm font-bold text-amber-900 dark:text-amber-300">
										กลุ่มเป้าหมายไม่ตรงกับเมนูนี้!
									</h5>
									<p class="text-xs text-amber-800 dark:text-amber-400">
										กลุ่มเป้าหมายเมนูนี้: [{menu.tags.join(', ')}] | คุณสมบัติผู้พักพิง: [{recipient.dietaryTags.join(
											', '
										)}]
									</p>
									<p class="text-xs font-semibold text-amber-700 dark:text-amber-500">
										สามารถข้ามคำเตือนเพื่อแจกจ่ายตามดุลยพินิจเจ้าหน้าที่ได้
									</p>
								</div>
							{/if}

							{#if store.selectedRecipientOverYield}
								<div
									class="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-center dark:border-amber-900/40 dark:bg-amber-950/20"
								>
									<AlertTriangle class="mx-auto size-5 text-amber-600" />
									<h5 class="text-sm font-bold text-amber-900 dark:text-amber-300">
										จำนวนที่แจกจะเกินยอดปรุงเสร็จ! (CR-109 Soft Warning)
									</h5>
									<p class="text-xs text-amber-800 dark:text-amber-400">
										เป้าหมายปรุงเสร็จ: {menu.target} ที่ | แจกไปแล้ว: {menu.served} ที่ | แจกเพิ่ม: {store.servePortions}
										ที่
									</p>
									<p class="text-xs font-semibold text-amber-700 dark:text-amber-500">
										อนุโลมให้เจ้าหน้าที่กดยืนยันแจกต่อได้ เพื่อไม่ให้การแจกจ่ายอาหารหน้างานหยุดชะงัก
									</p>
								</div>
							{/if}
						{/if}

						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								class="flex-1 text-xs font-bold"
								onclick={() => store.deselectRecipient()}
							>
								ยกเลิก (Esc)
							</Button>
							<Button
								disabled={store.selectedRecipientAlreadyServed}
								onclick={() => store.confirmServe()}
								class="flex-1 gap-1.5 text-xs font-bold text-white {store.selectedRecipientMismatch ||
								store.selectedRecipientOverYield
									? 'bg-amber-600 hover:bg-amber-700'
									: 'bg-emerald-600 hover:bg-emerald-700'}"
							>
								{store.selectedRecipientMismatch || store.selectedRecipientOverYield
									? 'ข้ามเตือน & ยืนยันแจก'
									: 'ยืนยันแจก'} ({store.servePortions}
								ที่) ↵
							</Button>
						</div>
					</div>
				{:else if !store.searchQuery.trim()}
					<div
						class="flex flex-col items-center justify-center space-y-3 rounded-xl border-2 border-dashed border-slate-100 py-16 text-center dark:border-zinc-800"
					>
						<div
							class="flex size-16 items-center justify-center rounded-full border bg-slate-50 text-slate-400 dark:bg-zinc-800"
						>
							{#if menu.status === 'closed'}
								<Lock class="size-8 text-rose-500" />
							{:else}
								<QrCode class="size-8" />
							{/if}
						</div>
						<div class="space-y-1">
							<h4 class="text-sm font-extrabold text-slate-900 dark:text-white">
								{menu.status === 'closed'
									? 'รอบแจกจ่ายเมนูนี้นอกช่วงเวลา (ปิดรอบแล้ว)'
									: 'พร้อมรับสแกน QR หรือ ค้นหารายชื่อ'}
							</h4>
							<p class="max-w-sm text-xs text-slate-400 dark:text-zinc-500">
								{menu.status === 'closed'
									? 'คุณกำลังดูประวัติการแจกอาหารของเมนูที่ปิดรอบแล้ว สามารถค้นหารายชื่อผู้ประสบภัยในช่องด้านบน หรือดูรายการด้านขวา'
									: 'ใช้เครื่องแสกนบาร์โค้ด หรือพิมพ์ค้นหาชื่อ/เลขบัตรในช่องด้านบน เพื่อเริ่มกระบวนการแจกจ่ายอาหาร'}
							</p>
						</div>

						<Badge
							variant="outline"
							class="gap-1.5 text-[10px] font-bold {menu.status === 'closed'
								? 'border-rose-100 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
								: 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'}"
						>
							<span
								class="size-1.5 rounded-full {menu.status === 'closed'
									? 'bg-rose-500'
									: 'bg-emerald-500'}"
							></span>
							<span>จุดแจกเมนู: {menu.title}</span>
						</Badge>
					</div>
				{:else}
					<div class="max-h-[350px] space-y-2 overflow-y-auto pr-1">
						<h5
							class="text-[11px] font-bold tracking-wider text-slate-400 uppercase dark:text-zinc-500"
						>
							ผลลัพธ์การค้นหา ({store.searchResults.length})
						</h5>
						{#if store.searchResults.length === 0}
							<div class="rounded-xl border border-dashed py-12 text-center text-xs text-slate-400">
								ไม่พบรายชื่อผู้ประสบภัยสอดคล้องกับการค้นหา
							</div>
						{:else}
							{#each store.searchResults as recipient (recipient.id)}
								{@const hasReceived = store.hasReceived(recipient.id, menu.id)}
								<div
									class="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 transition-colors hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900/30 dark:hover:bg-zinc-800"
								>
									<div class="space-y-1">
										<div class="flex items-center gap-2">
											<span class="text-sm font-bold text-slate-900 dark:text-white"
												>{recipient.name}</span
											>
											<span class="text-xs text-slate-400">อายุ {recipient.age} ปี</span>
										</div>
										<div class="flex items-center gap-2 text-[10px] text-slate-400">
											<span>เตียง {recipient.bed}</span>
											<span>•</span>
											<span>โทร: {recipient.phone}</span>
										</div>
										<div class="flex gap-1">
											{#each recipient.dietaryTags as diet (diet)}
												<Badge
													variant="outline"
													class="border-none bg-slate-100 text-[9px] font-bold text-slate-600 dark:bg-zinc-800 dark:text-slate-400"
												>
													{diet}
												</Badge>
											{/each}
										</div>
									</div>

									<div>
										{#if hasReceived}
											<span
												class="inline-flex items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:bg-emerald-950/20"
											>
												<CheckCircle2 class="size-3.5" />
												<span>รับประทานแล้ว</span>
											</span>
										{:else}
											<Button
												size="sm"
												onclick={() => store.selectRecipient(recipient)}
												class="bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
											>
												บันทึกแจกจ่าย
											</Button>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Right: live log -->
		<div class="space-y-4 lg:col-span-5">
			<div
				class="flex min-h-[420px] flex-col justify-between space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="space-y-4">
					<div
						class="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-zinc-800"
					>
						<div>
							<h4
								class="flex items-center gap-1.5 text-sm font-extrabold text-slate-800 dark:text-white"
							>
								<ClipboardList class="size-4" />
								<span>ประวัติการแจกอาหารรอบนี้</span>
							</h4>
							<p class="text-[10px] text-slate-400 dark:text-zinc-500">
								รายการแจกอาหารเรียลไทม์ (Live Logs) • {menu.title}
							</p>
						</div>

						<Badge
							variant="outline"
							class="border-emerald-200 text-[10px] font-extrabold text-emerald-700"
						>
							แจกแล้ว {menu.served} / {menu.target} ที่
						</Badge>
					</div>

					{#if store.menuTransactions.length === 0}
						<div
							class="flex flex-col items-center justify-center space-y-2 py-20 text-center text-slate-400"
						>
							<Clock class="size-8 opacity-45" />
							<div>
								<h5 class="text-xs font-bold text-slate-600 dark:text-zinc-400">
									ยังไม่มีประวัติการแจกในเมนูนี้
								</h5>
								<p class="text-[10px] text-slate-400">
									คิวประวัติการแจกจะแสดงที่นี่หลังจากมีการบันทึกการแจก
								</p>
							</div>
						</div>
					{:else}
						<div class="max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
							{#each store.menuTransactions as tx (tx.id)}
								<div
									transition:slide={{ duration: 150 }}
									class="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs dark:border-zinc-800 {tx.status ===
									'voided'
										? 'bg-slate-100/60 opacity-60'
										: ''}"
								>
									<div class="space-y-1">
										<div
											class="font-bold text-slate-900 dark:text-white {tx.status === 'voided'
												? 'text-slate-400 line-through'
												: ''}"
										>
											{tx.recipientName}
										</div>
										<div class="flex items-center gap-2 text-[10px] text-slate-400">
											<span>เตียง {tx.bed}</span>
											<span>•</span>
											<span>เวลา {tx.time} น.</span>
										</div>
									</div>

									<div class="flex items-center gap-2">
										{#if tx.status === 'voided'}
											<span
												class="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600"
												>ยกเลิกแล้ว</span
											>
										{:else}
											<span class="font-bold text-emerald-600">+{tx.portions} กล่อง</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div
					class="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-zinc-800/80"
				>
					<span class="text-xs font-bold text-slate-500 dark:text-zinc-400">
						คงเหลือ: <strong class="text-slate-950 dark:text-white"
							>{Math.max(0, menu.target - menu.served)} ที่</strong
						>
					</span>

					{#if menu.status === 'ready'}
						<Button
							onclick={() => store.requestCloseBatch(menu)}
							class="gap-1.5 bg-rose-600 text-xs font-bold text-white shadow-sm transition-all hover:scale-[1.01] hover:bg-rose-700"
						>
							<RotateCcw class="size-3.5" />
							<span>ปิดรอบแจกเมนูนี้</span>
						</Button>
					{:else}
						<Button
							variant="secondary"
							onclick={() => store.stopKiosk()}
							class="gap-1.5 text-xs font-bold"
						>
							<ArrowLeft class="size-3.5" />
							<span>กลับหน้าเลือกรอบ</span>
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

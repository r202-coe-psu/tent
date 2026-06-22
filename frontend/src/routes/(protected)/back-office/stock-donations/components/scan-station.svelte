<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';

	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');

	// Mocked scanned booking data
	let bookingRef = $state('DN-582910');
	let donorName = $state('คุณสมชาย ใจดี');
	let scannedItems = $state([
		{ name: 'น้ำดื่ม', qty: 50, unit: 'แพ็ค' },
		{ name: 'ปลากระป๋อง', qty: 100, unit: 'กระป๋อง' }
	]);

	function startScan() {
		scanState = 'scanning';
		setTimeout(() => {
			scanState = 'result';
		}, 1500); // 1.5s simulated scan processing
	}

	function handleCancel() {
		scanState = 'idle';
	}

	function handleSave() {
		toast.success(`บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef})`);
		// Print saved quantities for demo purposes
		scannedItems.forEach(item => {
			toast.info(`รับเข้า: ${item.name} จำนวน ${item.qty} ${item.unit}`);
		});
		scanState = 'idle';
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Section Header -->
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<Scan class="h-5 w-5 text-primary" />
				ระบบสแกนรับของเข้าคลัง (Ref. Scan Station)
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค เพื่อตรวจรับสินค้าและอัปเดตระบบคลังพัสดุแบบทันที (Real-time Sync)
			</p>
		</div>
	</div>

	<!-- Scan Body -->
	<div class="p-6 flex items-center justify-center min-h-[420px] bg-muted/5">
		{#if scanState === 'idle'}
			<!-- Idle State -->
			<div class="w-full max-w-md rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs flex flex-col items-center justify-center animate-in fade-in duration-200">
				<div class="h-16 w-16 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center text-primary mb-4">
					<Camera class="h-8 w-8" />
				</div>
				<h3 class="text-sm font-bold text-foreground mb-1">เปิดกล้องสแกนคิวอาร์โค้ด</h3>
				<p class="text-xs text-muted-foreground max-w-xs mb-6 leading-relaxed">
					เปิดกล้องหรือจำลองการอ่าน QR Code บนฟอร์มส่งมอบพัสดุและเสบียงอาหาร
				</p>
				<Button onclick={startScan} class="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold">
					<Scan class="h-4 w-4" />
					จำลองการสแกน (Mock Scan)
				</Button>
			</div>
		{:else if scanState === 'scanning'}
			<!-- Scanning State -->
			<div class="w-full max-w-md rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs flex flex-col items-center justify-center animate-in fade-in duration-200">
				<!-- Pulsing QR Code Box with scanning effect -->
				<div class="relative h-32 w-32 rounded-2xl bg-slate-900 flex items-center justify-center text-blue-500 mb-6 overflow-hidden border border-blue-500/30">
					<QrCode class="h-16 w-16" />
					<!-- Scanning horizontal bar effect -->
					<div class="absolute inset-x-0 h-1 bg-blue-500/80 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" style="animation: scanEffect 1.5s infinite ease-in-out;"></div>
				</div>
				<span class="text-xs font-bold text-muted-foreground animate-pulse">กำลังสแกน...</span>
			</div>
		{:else if scanState === 'result'}
			<!-- Result State -->
			<div class="w-full max-w-md animate-in rounded-3xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95 overflow-hidden">
				<!-- Header -->
				<div class="flex items-start justify-between bg-zinc-950 p-5 text-white border-b border-border/20">
					<div>
						<div class="flex items-center gap-2 mb-1.5">
							<span class="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">BOOKING REF.</span>
							<span class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-black">{bookingRef}</span>
						</div>
						<h3 class="text-sm font-bold text-white">
							ชื่อผู้บริจาค: <span class="text-amber-400 font-semibold">{donorName}</span>
						</h3>
					</div>
					<button
						type="button"
						onclick={handleCancel}
						class="cursor-pointer rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
					>
						<X class="h-4.5 w-4.5" />
					</button>
				</div>

				<!-- Body (Quantities Editing) -->
				<div class="p-5 space-y-4 bg-card">
					<h4 class="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">
						รายการที่จองไว้ (ตรวจนับความถูกต้อง)
					</h4>

					<div class="space-y-2.5">
						{#each scannedItems as item}
							<div class="flex items-center justify-between rounded-xl bg-muted/30 border border-border/40 p-3">
								<span class="text-xs font-bold text-foreground">{item.name}</span>
								<div class="flex items-center gap-2">
									<Input
										type="number"
										min="0"
										bind:value={item.qty}
										class="w-20 text-right h-8 rounded-lg bg-card text-xs font-semibold px-2"
									/>
									<span class="text-[11px] text-muted-foreground font-semibold w-12">{item.unit}</span>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Footer -->
				<div class="p-4 bg-muted/10 border-t border-border/60">
					<Button
						onclick={handleSave}
						class="w-full cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 text-xs transition-colors"
					>
						<Check class="h-4 w-4" />
						บันทึกของเข้าคลังเรียบร้อย
					</Button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes scanEffect {
		0% { top: 10%; }
		50% { top: 90%; }
		100% { top: 10%; }
	}
</style>

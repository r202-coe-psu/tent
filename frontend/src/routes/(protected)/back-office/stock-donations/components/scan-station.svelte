<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import type { ScanDonationView } from '$lib/features/donations';

	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');
	let searchQuery = $state('');

	// Redacted scanned booking data (ScanDonationView from the back-office API)
	let donationDoc = $state<ScanDonationView | null>(null);
	let bookingRef = $state('');
	let donorName = $state('');
	let scannedItems = $state<{ name: string; qty: number; unit: string; item_id?: string }[]>([]);

	async function performLookup(query: string) {
		if (!query.trim()) return;
		scanState = 'scanning';
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(query.trim())}`);
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				toast.error(errorData.error || 'ไม่พบข้อมูลการจองบริจาคนี้');
				scanState = 'idle';
				return;
			}
			const data = await res.json();
			if (data.success && data.donation) {
				donationDoc = data.donation as ScanDonationView;
				bookingRef = donationDoc?.booking_ref || '';
				donorName = donationDoc?.donor?.name || 'ไม่ระบุชื่อ';
				scannedItems = (donationDoc?.items || []).map((it) => ({
					name: it.free_text || it.item_id || 'ไม่ระบุชื่อสินค้า',
					qty: it.qty || 0,
					unit: it.unit || 'ชิ้น',
					item_id: it.item_id
				}));
				scanState = 'result';
			} else {
				toast.error('ไม่พบข้อมูลการจองบริจาคนี้');
				scanState = 'idle';
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการตรวจสอบข้อมูล');
			scanState = 'idle';
		}
	}

	function startScan() {
		performLookup('DN-582910');
	}

	function handleCancel() {
		scanState = 'idle';
		searchQuery = '';
		donationDoc = null;
	}

	async function handleSave() {
		if (!bookingRef) return;
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(bookingRef)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'received',
					items: scannedItems.map((it) => ({
						item_id: it.item_id,
						free_text: it.name,
						qty: it.qty,
						unit: it.unit
					}))
				})
			});
			const data = await res.json();
			if (data.success) {
				toast.success(`บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef})`);
				scannedItems.forEach((item) => {
					toast.info(`รับเข้า: ${item.name} จำนวน ${item.qty} ${item.unit}`);
				});
				scanState = 'idle';
				searchQuery = '';
				donationDoc = null;
			} else {
				toast.error(data.error || 'บันทึกไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		}
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
				สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค เพื่อตรวจรับสินค้าและอัปเดตระบบคลังพัสดุแบบทันที
				(Real-time Sync)
			</p>
		</div>
	</div>

	<!-- Scan Body -->
	<div class="flex min-h-[420px] items-center justify-center bg-muted/5 p-6">
		{#if scanState === 'idle'}
			<!-- Idle State -->
			<div
				class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs duration-200 fade-in"
			>
				<div
					class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-primary dark:bg-blue-950/30"
				>
					<Camera class="h-8 w-8" />
				</div>
				<h3 class="mb-1 text-sm font-bold text-foreground">สแกนหรือค้นหาใบจองบริจาค</h3>
				<p class="mb-6 max-w-xs text-xs leading-relaxed text-muted-foreground">
					กรอกรหัสการจอง (เช่น DN-xxxxxx) หรือสแกน QR Code จากมือถือผู้บริจาค
				</p>

				<div class="mb-4 flex w-full gap-2">
					<Input
						type="text"
						placeholder="รหัสการจอง (e.g. DN-123456) หรือ Token"
						bind:value={searchQuery}
						onkeydown={(e) => e.key === 'Enter' && performLookup(searchQuery)}
						class="h-10 rounded-xl text-xs"
					/>
					<Button
						onclick={() => performLookup(searchQuery)}
						disabled={!searchQuery.trim()}
						class="h-10 shrink-0 rounded-xl px-4 text-xs font-bold"
					>
						ค้นหา
					</Button>
				</div>

				<div class="relative my-2 flex w-full items-center justify-center">
					<div class="absolute inset-x-0 h-px bg-border"></div>
					<span
						class="relative bg-card px-3 text-[10px] font-bold tracking-wider text-muted-foreground uppercase"
						>หรือ</span
					>
				</div>

				<Button
					onclick={startScan}
					variant="outline"
					class="mt-2 flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold"
				>
					<Scan class="h-4 w-4" />
					จำลองสแกนใบจองตัวอย่าง (DN-582910)
				</Button>
			</div>
		{:else if scanState === 'scanning'}
			<!-- Scanning State -->
			<div
				class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs duration-200 fade-in"
			>
				<!-- Pulsing QR Code Box with scanning effect -->
				<div
					class="relative mb-6 flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl border border-blue-500/30 bg-slate-900 text-blue-500"
				>
					<QrCode class="h-16 w-16" />
					<!-- Scanning horizontal bar effect -->
					<div
						class="absolute inset-x-0 h-1 animate-pulse bg-blue-500/80 shadow-[0_0_8px_rgba(59,130,246,0.8)]"
						style="animation: scanEffect 1.5s infinite ease-in-out;"
					></div>
				</div>
				<span class="animate-pulse text-xs font-bold text-muted-foreground">กำลังสแกน...</span>
			</div>
		{:else if scanState === 'result'}
			<!-- Result State -->
			<div
				class="w-full max-w-md animate-in overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
			>
				<!-- Header -->
				<div
					class="flex items-start justify-between border-b border-border/20 bg-zinc-950 p-5 text-white"
				>
					<div>
						<div class="mb-1.5 flex items-center gap-2">
							<span class="text-[9px] font-bold tracking-wide text-zinc-400 uppercase"
								>BOOKING REF.</span
							>
							<span class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-black"
								>{bookingRef}</span
							>
						</div>
						<h3 class="text-sm font-bold text-white">
							ชื่อผู้บริจาค: <span class="font-semibold text-amber-400">{donorName}</span>
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
				<div class="space-y-4 bg-card p-5">
					<h4 class="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
						รายการที่จองไว้ (ตรวจนับความถูกต้อง)
					</h4>

					<div class="space-y-2.5">
						{#each scannedItems as item (item.name)}
							<div
								class="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 p-3"
							>
								<span class="text-xs font-bold text-foreground">{item.name}</span>
								<div class="flex items-center gap-2">
									<Input
										type="number"
										min="0"
										bind:value={item.qty}
										class="h-8 w-20 rounded-lg bg-card px-2 text-right text-xs font-semibold"
									/>
									<span class="w-12 text-[11px] font-semibold text-muted-foreground"
										>{item.unit}</span
									>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Footer -->
				<div class="border-t border-border/60 bg-muted/10 p-4">
					<Button
						onclick={handleSave}
						class="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
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
		0% {
			top: 10%;
		}
		50% {
			top: 90%;
		}
		100% {
			top: 10%;
		}
	}
</style>

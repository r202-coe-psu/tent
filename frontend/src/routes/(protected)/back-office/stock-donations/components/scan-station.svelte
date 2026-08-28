<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import type { ScanDonationView } from '$lib/features/donations';

	/**
	 * `initialQuery` — set when opened from the "กำลังตรวจรับ (Verifying)" tab
	 * (R-16.5): the row is already known, so the lookup runs immediately instead
	 * of waiting on a manual search. `onSaved` lets that tab refresh its list.
	 *
	 * `onClose` is what the verifying tab passes to get its LIST back. Without it,
	 * dismissing the card dropped staff on a bare search box that looks exactly
	 * like the scan tab, with no way back to the queue they came from.
	 */
	let {
		initialQuery = '',
		onSaved,
		onClose
	}: { initialQuery?: string; onSaved?: () => void; onClose?: () => void } = $props();

	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');
	let searchQuery = $state('');

	// Redacted scanned booking data (ScanDonationView from the back-office API)
	let donationDoc = $state<ScanDonationView | null>(null);
	let bookingRef = $state('');
	let donorName = $state('');
	type ScannedItem = {
		key: string;
		name: string;
		/** qty_str — kept as a string end to end (CR-038); never bound to a number input. */
		qty: string;
		unit: string;
		item_id?: string;
		/** Required by the API for perishable catalog items (schema.md §2.1). */
		expiry: string;
		/** Where the goods are put away — free text, no zone master data yet (CR-088). */
		storage_zone: string;
	};
	let scannedItems = $state<ScannedItem[]>([]);
	let remarks = $state('');
	let saving = $state(false);
	/**
	 * Lot labels the server minted on the last successful receive (CR-088). Staff
	 * write these on the physical boxes, so they must survive the form resetting
	 * back to the idle state.
	 */
	let lastLots = $state<{ item_id: string; lot_no: string | null }[]>([]);

	async function performLookup(query: string) {
		if (!query.trim()) return;
		lastLots = [];
		scanState = 'scanning';
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(query.trim())}`);
			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				toast.error(errorData.error || 'ไม่พบข้อมูลการจองบริจาคนี้');
				scanState = 'idle';
				onClose?.();
				return;
			}
			const data = await res.json();
			if (data.success && data.donation) {
				donationDoc = data.donation as ScanDonationView;
				bookingRef = donationDoc?.booking_ref || '';
				donorName = donationDoc?.donor?.name || 'ไม่ระบุชื่อ';
				scannedItems = (donationDoc?.items || []).map((it, i) => ({
					key: `${it.item_id ?? it.free_text ?? 'line'}-${i}`,
					name: it.free_text || it.item_id || 'ไม่ระบุชื่อสินค้า',
					qty: it.qty != null && it.qty !== '' ? String(it.qty) : '0',
					unit: it.unit || 'ชิ้น',
					item_id: it.item_id,
					expiry: '',
					storage_zone: ''
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

	function handleCancel() {
		scanState = 'idle';
		lastLots = [];
		searchQuery = '';
		donationDoc = null;
		scannedItems = [];
		remarks = '';
		// Opened from a queue → hand control back to it instead of leaving staff on
		// an idle search box that belongs to a different tab.
		onClose?.();
	}

	async function handleSave() {
		if (!bookingRef || saving) return;
		saving = true;
		try {
			const res = await fetch(`/api/back-office/donations/${encodeURIComponent(bookingRef)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'received',
					...(remarks.trim() ? { remarks: remarks.trim() } : {}),
					// A line is either a catalog item (item_id → stock ledger) or free text
					// (stays on the donation) — never both.
					// `lot_no` is not sent — the server mints the per-day sequence (CR-088).
					items: scannedItems.map((it) => ({
						...(it.item_id ? { item_id: it.item_id } : { free_text: it.name }),
						qty: it.qty,
						unit: it.unit,
						...(it.item_id && (it.expiry || it.storage_zone.trim())
							? {
									lot: {
										...(it.expiry ? { expiry: it.expiry } : {}),
										...(it.storage_zone.trim() ? { storage_zone: it.storage_zone.trim() } : {})
									}
								}
							: {})
					}))
				})
			});
			const data = await res.json();
			if (data.success) {
				lastLots = (data.lots ?? []) as { item_id: string; lot_no: string | null }[];
				const labels = lastLots.map((l) => l.lot_no).filter(Boolean);
				toast.success(
					labels.length
						? `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef}) · เลขล็อต ${labels.join(', ')}`
						: `บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef})`
				);
				scanState = 'idle';
				searchQuery = '';
				donationDoc = null;
				remarks = '';
				onSaved?.();
			} else if (data.error_code === 'CATALOG_MISMATCH') {
				// R-16.6 — a raw English invariant message ("Unit mismatch for item
				// item:soap: expected bar, got ก้อน") tells warehouse staff nothing they
				// can act on: the offending unit is on the BOOKING, and this screen has
				// no field to correct it. Say who has to fix it, and keep the detail.
				toast.error('หน่วยในใบจองไม่ตรงกับหน่วยมาตรฐานในคลัง — รับเข้าคลังไม่ได้', {
					description: `${data.error} · แก้ที่ต้นทางใบจอง หรือแจ้งผู้ดูแลระบบ`,
					duration: 12_000
				});
			} else {
				toast.error(data.error || 'บันทึกไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			saving = false;
		}
	}

	// One-shot at mount, deliberately NOT a reactive binding: the verifying tab
	// remounts this component per booking ref, so `initialQuery` never changes
	// under a live instance.
	onMount(() => {
		if (!initialQuery) return;
		searchQuery = initialQuery;
		performLookup(initialQuery);
	});
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
			<p class="mt-1 text-2xs text-muted-foreground">
				สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค เพื่อตรวจรับสินค้าและอัปเดตระบบคลังพัสดุแบบทันที
				(Real-time Sync)
			</p>
		</div>
	</div>

	<!-- Scan Body -->
	<div class="flex min-h-[420px] flex-col items-center justify-center gap-6 bg-muted/5 p-6">
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

				{#if lastLots.length}
					<div
						class="w-full rounded-xl border border-emerald-500/30 bg-emerald-50/60 p-3 text-left dark:bg-emerald-950/20"
					>
						<p
							class="text-2xs font-extrabold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
						>
							เลขล็อตที่ระบบออกให้ (เขียนติดกล่อง)
						</p>
						<ul class="mt-1.5 space-y-1">
							{#each lastLots as lot (lot.item_id + (lot.lot_no ?? ''))}
								<li class="flex items-center justify-between gap-2 text-2xs">
									<span class="text-muted-foreground">{lot.item_id}</span>
									<span class="font-mono font-bold text-foreground">{lot.lot_no ?? '—'}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
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
							<span class="text-3xs font-bold tracking-wide text-zinc-400 uppercase"
								>BOOKING REF.</span
							>
							<span class="rounded bg-amber-500 px-1.5 py-0.5 text-2xs font-extrabold text-black"
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
					<h4 class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase">
						รายการที่จองไว้ (ตรวจนับความถูกต้อง)
					</h4>

					<div class="space-y-2.5">
						{#each scannedItems as item (item.key)}
							<div class="rounded-xl border border-border/40 bg-muted/30 p-3">
								<div class="flex items-center justify-between">
									<span class="text-xs font-bold text-foreground">{item.name}</span>
									<div class="flex items-center gap-2">
										<Input
											type="text"
											inputmode="decimal"
											bind:value={item.qty}
											class="h-8 w-20 rounded-lg bg-card px-2 text-right text-xs font-semibold"
										/>
										<span class="w-12 text-2xs font-semibold text-muted-foreground"
											>{item.unit}</span
										>
									</div>
								</div>
								{#if item.item_id}
									<label
										class="mt-2 flex items-center justify-between gap-2 text-2xs font-semibold text-muted-foreground"
									>
										วันหมดอายุ (เฉพาะของที่มีวันหมดอายุ)
										<Input
											type="date"
											bind:value={item.expiry}
											class="h-7 w-36 rounded-lg bg-card px-2 text-2xs"
										/>
									</label>
									<label
										class="mt-1.5 flex items-center justify-between gap-2 text-2xs font-semibold text-muted-foreground"
									>
										โซนจัดเก็บ
										<Input
											type="text"
											bind:value={item.storage_zone}
											placeholder="เช่น A-01"
											maxlength={100}
											class="h-7 w-36 rounded-lg bg-card px-2 text-2xs"
										/>
									</label>
								{:else}
									<p class="mt-1.5 text-2xs text-muted-foreground">
										ไม่มีรหัสสินค้าในคลัง — บันทึกไว้ในใบบริจาค ไม่ตัดยอดเข้าคลัง
									</p>
								{/if}
							</div>
						{/each}
					</div>

					<label class="block">
						<span class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
							>หมายเหตุการตรวจรับ</span
						>
						<Input
							type="text"
							bind:value={remarks}
							placeholder="เช่น ของมาไม่ครบตามที่แจ้ง"
							class="mt-1.5 h-9 rounded-xl text-xs"
						/>
					</label>
				</div>

				<!-- Footer -->
				<div class="border-t border-border/60 bg-muted/10 p-4">
					<Button
						onclick={handleSave}
						disabled={saving}
						class="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
					>
						<Check class="h-4 w-4" />
						{saving ? 'กำลังบันทึก…' : 'บันทึกของเข้าคลังเรียบร้อย'}
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

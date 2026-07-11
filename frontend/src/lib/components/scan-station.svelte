<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import User from '@lucide/svelte/icons/user';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import { untrack, onMount } from 'svelte';

	let activeMode = $state<'scan' | 'walkin'>('scan');
	let scanState = $state<'idle' | 'scanning' | 'result'>('idle');

	// Mocked scanned booking data
	let bookingRef = $state('DN-582910');
	let donorName = $state('คุณสมชาย ใจดี');
	let scannedItems = $state([
		{ name: 'น้ำดื่ม', qty: 50, unit: 'แพ็ค' },
		{ name: 'ปลากระป๋อง', qty: 100, unit: 'กระป๋อง' }
	]);

	// Walk-in data
	let walkinDonorName = $state('');
	let walkinDonorPhone = $state('');
	let walkinItems = $state([{ name: '', qty: 1, unit: 'ชิ้น' }]);

	let scanner: unknown = null;
	let libReady = $state(false);

	/** Dynamically inject html5-qrcode from CDN so no npm install is needed */
	onMount(() => {
		if ((window as unknown as { Html5QrcodeScanner: unknown }).Html5QrcodeScanner) {
			libReady = true;
			return;
		}
		const script = document.createElement('script');
		script.src = '/html5-qrcode.min.js';
		script.onload = () => {
			libReady = true;
		};
		script.onerror = () => {
			toast.error('ไม่สามารถโหลดไลบรารีสแกน QR Code ได้ — กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
		};
		document.head.appendChild(script);
	});

	$effect(() => {
		if (scanState === 'scanning' && libReady) {
			untrack(() => {
				// Give Svelte one tick so #qr-reader is in the DOM
				setTimeout(() => {
					scanner = new (
						window as unknown as { Html5QrcodeScanner: new (...args: unknown[]) => unknown }
					).Html5QrcodeScanner(
						'qr-reader',
						{ fps: 10, qrbox: { width: 250, height: 250 } },
						/* verbose= */ false
					);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(scanner as any).render(onScanSuccess, onScanFailure);
				}, 50);
			});
		} else if (scanState !== 'scanning') {
			if (scanner) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(scanner as any).clear().catch(console.error);
				scanner = null;
			}
		}

		return () => {
			if (scanner) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(scanner as any).clear().catch(console.error);
			}
		};
	});

	function startScan() {
		if (!libReady) {
			toast.error('ไลบรารีสแกนยังไม่พร้อม กรุณารอสักครู่แล้วลองใหม่');
			return;
		}
		scanState = 'scanning';
	}

	function onScanSuccess(decodedText: string) {
		bookingRef = decodedText.includes('TX-') ? decodedText : 'DN-' + decodedText.substring(0, 6);
		donorName = 'คุณสมชาย ใจดี';
		scannedItems = [
			{ name: 'น้ำดื่ม', qty: 50, unit: 'แพ็ค' },
			{ name: 'ปลากระป๋อง', qty: 100, unit: 'กระป๋อง' }
		];
		scanState = 'result';
		if (scanner) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(scanner as any).clear().catch(console.error);
			scanner = null;
		}
	}

	function onScanFailure() {
		// Ignore continuous scan failures silently
	}

	function handleCancel() {
		scanState = 'idle';
	}

	function handleSaveScan() {
		toast.success(`บันทึกรับเข้าคลังเรียบร้อยแล้ว (Ref. ${bookingRef})`);
		scannedItems.forEach((item) => {
			toast.info(`รับเข้า: ${item.name} จำนวน ${item.qty} ${item.unit}`);
		});
		scanState = 'idle';
	}

	function handleSaveWalkin() {
		if (!walkinDonorName) {
			toast.error('กรุณาระบุชื่อผู้บริจาค');
			return;
		}
		if (walkinItems.some((i) => !i.name || i.qty <= 0 || !i.unit)) {
			toast.error('กรุณาระบุข้อมูลสิ่งของให้ครบถ้วน');
			return;
		}
		toast.success(`บันทึกรับเข้าคลังแบบ Walk-in สำเร็จ (${walkinDonorName})`);
		walkinDonorName = '';
		walkinDonorPhone = '';
		walkinItems = [{ name: '', qty: 1, unit: 'ชิ้น' }];
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
				ระบบรับของเข้าคลัง (Intake Station)
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				สแกนคิวอาร์โค้ดใบจองจากมือถือผู้บริจาค หรือลงทะเบียนรับของบริจาคแบบ Walk-in
			</p>
		</div>

		<!-- Mode Switcher -->
		<div class="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/50 p-1">
			<button
				type="button"
				onclick={() => (activeMode = 'scan')}
				class="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition-colors {activeMode ===
				'scan'
					? 'bg-card text-primary shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของ (แจ้งล่วงหน้า)
			</button>
			<button
				type="button"
				onclick={() => (activeMode = 'walkin')}
				class="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold transition-colors {activeMode ===
				'walkin'
					? 'bg-card text-primary shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<User class="h-3.5 w-3.5" />
				รับแบบ Walk-in
			</button>
		</div>
	</div>

	<!-- Scan Mode Body -->
	{#if activeMode === 'scan'}
		<div class="flex min-h-[420px] items-center justify-center bg-muted/5 p-6">
			{#if scanState === 'idle'}
				<div
					class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card p-8 text-center shadow-xs duration-200 fade-in"
				>
					<div
						class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-primary dark:bg-blue-950/30"
					>
						<Camera class="h-8 w-8" />
					</div>
					<h3 class="mb-1 text-sm font-bold text-foreground">เปิดกล้องสแกนคิวอาร์โค้ด</h3>
					<p class="mb-6 max-w-xs text-xs leading-relaxed text-muted-foreground">
						เปิดกล้องหรือจำลองการอ่าน QR Code บนฟอร์มส่งมอบพัสดุและเสบียงอาหาร
					</p>
					<Button
						onclick={startScan}
						disabled={!libReady}
						class="flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold"
					>
						<Scan class="h-4 w-4" />
						{libReady ? 'เปิดกล้องเพื่อสแกน (Start Camera)' : 'กำลังโหลด...'}
					</Button>
				</div>
			{:else if scanState === 'scanning'}
				<div
					class="flex w-full max-w-md animate-in flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card p-6 text-center shadow-xs duration-200 fade-in"
				>
					<h3 class="mb-4 text-sm font-bold text-foreground">หันกล้องไปที่คิวอาร์โค้ด</h3>
					<div
						id="qr-reader"
						class="w-full overflow-hidden rounded-xl border border-border/50"
					></div>
					<Button variant="outline" onclick={handleCancel} class="mt-6 w-full rounded-xl font-bold">
						ยกเลิก
					</Button>
				</div>
			{:else if scanState === 'result'}
				<div
					class="w-full max-w-md animate-in overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
				>
					<div
						class="flex items-start justify-between border-b border-border/20 bg-zinc-950 p-5 text-white"
					>
						<div>
							<div class="mb-1.5 flex items-center gap-2">
								<span class="text-[9px] font-bold tracking-wide text-zinc-400 uppercase"
									>BOOKING REF.</span
								>
								<span
									class="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-black"
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

					<div class="space-y-4 bg-card p-5">
						<h4 class="text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
							รายการที่จองไว้ (กรอกจำนวนที่รับจริง)
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
											class="h-8 w-20 rounded-lg border-primary/50 bg-card px-2 text-right text-xs font-semibold focus:border-primary"
										/>
										<span class="w-12 text-[11px] font-semibold text-muted-foreground"
											>{item.unit}</span
										>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<div class="border-t border-border/60 bg-muted/10 p-4">
						<Button
							onclick={handleSaveScan}
							class="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
						>
							<Check class="h-4 w-4" />
							บันทึกของเข้าคลังเรียบร้อย
						</Button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Walk-in Mode Body -->
	{#if activeMode === 'walkin'}
		<div class="min-h-[420px] bg-muted/5 p-6">
			<div
				class="mx-auto max-w-2xl animate-in rounded-2xl border border-border bg-card p-6 shadow-xs duration-200 fade-in"
			>
				<div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
					<div>
						<div class="mb-1.5 block text-xs font-bold text-muted-foreground">
							ชื่อผู้บริจาค <span class="text-red-500">*</span>
						</div>
						<Input
							bind:value={walkinDonorName}
							placeholder="เช่น คุณสมชาย ใจดี"
							class="h-9 text-xs"
						/>
					</div>
					<div>
						<div class="mb-1.5 block text-xs font-bold text-muted-foreground">เบอร์โทรติดต่อ</div>
						<Input bind:value={walkinDonorPhone} placeholder="08X-XXX-XXXX" class="h-9 text-xs" />
					</div>
				</div>

				<div class="mb-4 flex items-center justify-between">
					<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
						รายการสิ่งของที่รับบริจาค
					</h4>
					<Button
						variant="outline"
						size="sm"
						onclick={() => (walkinItems = [...walkinItems, { name: '', qty: 1, unit: 'ชิ้น' }])}
						class="h-7 text-[10px] font-bold"
					>
						<Plus class="mr-1 h-3 w-3" />
						เพิ่มรายการ
					</Button>
				</div>

				<div class="mb-8 space-y-3">
					{#each walkinItems as item, idx (idx)}
						<div class="flex items-start gap-2 sm:items-center">
							<div class="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-12">
								<div class="sm:col-span-6">
									<Input bind:value={item.name} placeholder="ชื่อสิ่งของ" class="h-8 text-xs" />
								</div>
								<div class="sm:col-span-3">
									<Input
										type="number"
										bind:value={item.qty}
										min="1"
										placeholder="จำนวน"
										class="h-8 text-right text-xs"
									/>
								</div>
								<div class="sm:col-span-3">
									<Input bind:value={item.unit} placeholder="หน่วย" class="h-8 text-xs" />
								</div>
							</div>
							{#if walkinItems.length > 1}
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 text-muted-foreground hover:text-red-500"
									onclick={() => (walkinItems = walkinItems.filter((_, i) => i !== idx))}
								>
									<Trash class="h-4 w-4" />
								</Button>
							{/if}
						</div>
					{/each}
				</div>

				<div class="border-t border-border/60 pt-4">
					<Button
						onclick={handleSaveWalkin}
						class="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 sm:w-auto"
					>
						<Check class="h-4 w-4" />
						บันทึกรับเข้าคลังแบบ Walk-in
					</Button>
				</div>
			</div>
		</div>
	{/if}
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

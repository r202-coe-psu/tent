<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import Search from '@lucide/svelte/icons/search';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import User from '@lucide/svelte/icons/user';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader from '@lucide/svelte/icons/loader';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ScanSearchModal from './scan-search-modal.svelte';
	import { peopleRepository, type Evacuee } from '$lib/features/people';

	let scanCode = $state('');
	let isScanning = $state(false);
	let scanResult = $state<{
		success: boolean;
		message: string;
		evacuee?: Evacuee;
		action?: 'check_in' | 'check_out';
	} | null>(null);

	let showSearchModal = $state(false);

	// Camera setup
	let enableCamera = $state(true);
	let cameraError = $state<string | null>(null);

	let lastScannedCode = '';
	let lastScanTime = 0;

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);

		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const qrboxSize = Math.floor(minDimension * 0.7);
						return {
							width: qrboxSize,
							height: qrboxSize
						};
					}
				},
				(decodedText) => {
					const scannedValue = decodedText.trim();
					if (scannedValue) {
						const now = Date.now();
						const isDuplicate = scannedValue === lastScannedCode;
						const cooldown = isDuplicate ? 3000 : 1500;

						if (!isScanning && now - lastScanTime > cooldown) {
							lastScanTime = now;
							lastScannedCode = scannedValue;

							if (typeof navigator !== 'undefined' && navigator.vibrate) {
								navigator.vibrate(100);
							}

							handleScanSubmit(scannedValue);
						}
					}
				},
				() => {
					// Silent error handler for parsing failures
				}
			)
			.catch((err) => {
				console.error('Html5Qrcode start error:', err);
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch((err) => {
					console.error('Html5Qrcode stop error:', err);
				});
			}
		};
	}

	// Handle scanning / lookup logic
	async function handleScanSubmit(code: string) {
		const cleanCode = code.trim();
		if (!cleanCode) return;

		isScanning = true;
		scanResult = null;

		try {
			let evacuee: Evacuee | null = null;

			// Find evacuee helper
			let lookupId = cleanCode;
			if (!lookupId.startsWith('evacuee:')) {
				lookupId = `evacuee:${cleanCode}`;
			}

			try {
				evacuee = await peopleRepository().getEvacuee(lookupId);
			} catch {
				// Ignore direct ID fetch errors and proceed to search
			}

			if (!evacuee) {
				const matches = await peopleRepository().searchEvacuees(cleanCode);
				if (matches.length > 0) {
					evacuee = matches[0];
				}
			}

			if (!evacuee) {
				scanResult = {
					success: false,
					message: `ไม่พบข้อมูลผู้ประสบภัยจากรหัส/ชื่อ "${cleanCode}"`
				};
				toast.error('ไม่พบรหัสผู้ประสบภัยนี้ในระบบ');
				isScanning = false;
				return;
			}

			scanResult = {
				success: true,
				message: 'พบข้อมูลผู้ประสบภัย',
				evacuee
			};
			toast.success(`พบข้อมูล ${evacuee.first_name} ${evacuee.last_name}`);
			scanCode = ''; // Clear input
		} catch (err) {
			console.error(err);
			scanResult = {
				success: false,
				message: `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`
			};
			toast.error('เกิดข้อผิดพลาดในการดำเนินการ');
		} finally {
			isScanning = false;
		}
	}

	onMount(() => {
		const handleSearchTrigger = () => {
			showSearchModal = true;
		};

		window.addEventListener('trigger-search', handleSearchTrigger);

		return () => {
			window.removeEventListener('trigger-search', handleSearchTrigger);
		};
	});

	// Helper for status label translation
	function getStatusLabel(status: string) {
		const statusLabels: Record<string, string> = {
			registered: 'ลงทะเบียนแล้ว (ยังไม่เช็คอิน)',
			checked_in: 'เช็คอินเข้าพักแล้ว',
			checked_out: 'เช็คเอาท์ออกแล้ว',
			transferred: 'ย้ายศูนย์พักพิงแล้ว'
		};
		return statusLabels[status] || status;
	}
</script>

<div class="container mx-auto max-w-4xl px-4 py-8">
	<!-- Navigation and Title Header -->
	<div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-4">
			<Button
				variant="secondary"
				size="icon"
				onclick={() => goto(resolve('/onsite'))}
				class="h-10 w-10 rounded-full"
				title="กลับ"
			>
				<ArrowLeft class="size-5" />
			</Button>
			<div>
				<h1
					class="flex items-center gap-2 text-xl font-bold text-slate-900 md:text-2xl dark:text-white"
				>
					<Scan class="size-5 text-[#0A2647] md:size-6 dark:text-blue-400" />
					สแกนเข้า-ออกศูนย์ (Check-in / Out)
				</h1>
				<p class="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
					สแกนรหัสเพื่อจัดการสถานะผู้พำนัก
				</p>
			</div>
		</div>
		<div class="flex items-center gap-3">
			<Button
				onclick={() => (showSearchModal = true)}
				class="h-10 rounded-xl bg-[#22C55E] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#16A34A]"
			>
				<Search class="mr-1.5 size-3.5" />
				ค้นหาด้วยชื่อ/เลขบัตร
			</Button>
		</div>
	</div>

	<!-- Main Centered Card Container -->
	<div class="mx-auto w-full max-w-xl">
		<!-- Scanner Viewport Card -->
		<Card.Root class="overflow-hidden border-slate-200 shadow-lg dark:border-slate-800">
			<Card.Content class="flex flex-col items-center">
				<!-- Viewfinder Area -->
				<div
					class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
					style="isolation: isolate; transform: translateZ(0);"
				>
					{#if enableCamera && !cameraError}
						<!-- Active Video Stream container for html5-qrcode -->
						<div
							id="qr-reader"
							class="h-full w-full overflow-hidden rounded-2xl [&_video]:!h-full [&_video]:!w-full [&_video]:!rounded-2xl [&_video]:!bg-transparent [&_video]:!object-cover"
							style="isolation: isolate; transform: translateZ(0);"
							{@attach cameraAttachment}
						></div>

						<!-- Scan Reticle Corners -->
						<div class="pointer-events-none absolute inset-4">
							<div
								class="absolute top-0 left-0 h-6 w-6 rounded-tl-md border-t-4 border-l-4 border-white/80"
							></div>
							<div
								class="absolute top-0 right-0 h-6 w-6 rounded-tr-md border-t-4 border-r-4 border-white/80"
							></div>
							<div
								class="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-white/80"
							></div>
							<div
								class="absolute right-0 bottom-0 h-6 w-6 rounded-br-md border-r-4 border-b-4 border-white/80"
							></div>
						</div>
					{:else}
						<!-- Disabled Camera State / Placeholder -->
						<div class="flex flex-col items-center justify-center p-6 text-center text-slate-400">
							{#if cameraError}
								<CameraOff class="mb-3 size-12 animate-bounce text-red-400" />
								<p class="text-xs font-semibold text-red-400">{cameraError}</p>
							{:else}
								<Scan class="mb-4 size-16 text-[#003B71]/30 dark:text-blue-500/20" />
								<p class="text-xs font-bold text-slate-400">กล้องสแกนเนอร์ปิดอยู่</p>
								<p class="mt-1 text-[10px] text-slate-500">
									สามารถค้นหาด้วยชื่อหรือพิมพ์รหัสแทนได้
								</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Instructions -->
				<div class="mt-6 text-center">
					<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">
						สแกนรหัสเพื่อจัดการสถานะ
					</h3>
					<p class="mt-2 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
						ใช้เครื่องสแกนบาร์โค้ดสแกนที่บัตรผู้ประสบภัย หรือพิมพ์รหัสลงในช่องด้านล่าง
						ระบบจะพาไปยังหน้าจัดการสถานะทันที
					</p>
				</div>

				<!-- Manual Input Form -->
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleScanSubmit(scanCode);
					}}
					class="mt-6 flex w-full max-w-sm gap-2"
				>
					<Input
						type="text"
						placeholder="กรอกรหัส หรือ สแกน QR..."
						bind:value={scanCode}
						disabled={isScanning}
						class="h-11 flex-1 border-slate-300 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-900"
					/>
					<Button
						type="submit"
						disabled={isScanning || !scanCode}
						class="h-11 bg-[#003B71] px-5 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#002a50]"
					>
						{#if isScanning}
							<Loader class="mr-1 size-4 animate-spin" />
						{/if}
						ตกลง
					</Button>
				</form>

				<!-- Scan Result Banner (inside Card) -->
				{#if scanResult}
					<div
						class="mt-6 w-full max-w-sm animate-in overflow-hidden rounded-xl border shadow-sm transition-all duration-200 fade-in slide-in-from-top-2
						{scanResult.success
							? 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10'
							: 'border-red-200 bg-red-50/40 dark:bg-red-950/10'}"
					>
						<div
							class="flex items-center gap-2 border-b border-inherit px-4 py-2.5 {scanResult.success
								? 'bg-emerald-500/10'
								: 'bg-red-500/10'}"
						>
							{#if scanResult.success}
								<CircleCheck class="size-4 text-emerald-500" />
							{:else}
								<AlertCircle class="size-4 text-red-500" />
							{/if}
							<span class="text-xs font-bold text-slate-900 dark:text-white">
								{scanResult.message}
							</span>
						</div>
						<div class="space-y-3 p-4">
							{#if scanResult.success && scanResult.evacuee}
								<div class="flex items-start gap-3">
									<div
										class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
									>
										<User class="size-5" />
									</div>
									<div class="min-w-0 flex-1 space-y-1">
										<h4 class="truncate text-sm font-bold text-slate-900 dark:text-white">
											{scanResult.evacuee.first_name}
											{scanResult.evacuee.last_name}
										</h4>
										<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
											สถานะ:
											<span
												class="py-0.2 inline-flex items-center gap-1 rounded-full px-2 text-[10px] font-bold shadow-xs
												{scanResult.evacuee.current_stay.status === 'checked_in'
													? 'bg-emerald-100 text-emerald-800'
													: 'bg-slate-100 text-slate-800'}"
											>
												{getStatusLabel(scanResult.evacuee.current_stay.status)}
											</span>
										</p>
										{#if scanResult.evacuee.current_stay.zone}
											<p class="text-[10px] font-medium text-slate-500">
												โซนพักพิง: <span
													class="font-bold text-slate-700 uppercase dark:text-slate-300"
													>{scanResult.evacuee.current_stay.zone}</span
												>
											</p>
										{/if}
									</div>
								</div>
								<div class="flex justify-end border-t border-slate-100 pt-2 dark:border-slate-800">
									<Button
										variant="outline"
										size="sm"
										class="h-7 rounded-lg px-2.5 text-[10px] font-bold"
										onclick={() =>
											goto(
												resolve(`/onsite/people/evacuee-profile-view/${scanResult?.evacuee?._id}`)
											)}
									>
										ดูโปรไฟล์แบบละเอียด
									</Button>
								</div>
							{:else}
								<p class="text-xs font-medium text-slate-500 dark:text-slate-400">
									โปรดตรวจสอบข้อมูลรหัสบัตรประชาชน หรือ QR code ของผู้ประสบภัยอีกครั้ง
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>

<!-- 2. Modal: Search Evacuees -->
<ScanSearchModal
	show={showSearchModal}
	onClose={() => (showSearchModal = false)}
	onSelect={(evacueeId) => {
		showSearchModal = false;
		scanCode = evacueeId;
		handleScanSubmit(scanCode);
	}}
/>

<style>
	:global(#qr-reader *) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}

	@keyframes scanEffect {
		0%,
		100% {
			top: 10px;
		}
		50% {
			top: calc(100% - 14px);
		}
	}
</style>

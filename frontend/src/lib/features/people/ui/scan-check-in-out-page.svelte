<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import Search from '@lucide/svelte/icons/search';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader from '@lucide/svelte/icons/loader';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ScanSearchModal from './scan-search-modal.svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import {
		canCheckInEvacuee,
		canCheckOutEvacuee,
		lookupEvacueeByScanCode,
		useCheckInEvacuee,
		useCheckOutEvacuee,
		type Evacuee,
		type StayStatus
	} from '$lib/features/people';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	let scanCode = $state('');
	let isScanning = $state(false);
	let scanResult = $state<{
		success: boolean;
		message: string;
		evacuee?: Evacuee;
	} | null>(null);

	let showSearchModal = $state(false);

	// Camera setup
	let enableCamera = $state(true);
	let cameraError = $state<string | null>(null);

	let lastScannedCode = '';
	let lastScanTime = 0;

	const queryClient = useQueryClient();
	const checkIn = useCheckInEvacuee();
	const checkOut = useCheckOutEvacuee();

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
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch(() => {
					// Nothing actionable to surface — the view is unmounting anyway.
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
			const evacuee = await lookupEvacueeByScanCode(queryClient, cleanCode);

			if (!evacuee) {
				scanResult = {
					success: false,
					message: `ไม่พบข้อมูลผู้ประสบภัยจากรหัส/ชื่อ "${cleanCode}" ในศูนย์ ${getShelterCode()}`
				};
				toast.error(`ไม่พบรหัสนี้ในศูนย์ ${getShelterCode()} — โปรดตรวจสอบศูนย์ที่เลือกด้านบน`);
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
			scanResult = {
				success: false,
				message: `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`
			};
			toast.error('เกิดข้อผิดพลาดในการดำเนินการ');
		} finally {
			isScanning = false;
		}
	}

	async function handleCheckIn(evacuee: Evacuee) {
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			const updated = await checkIn.mutateAsync({ evacuee, ctx });
			if (scanResult?.evacuee?._id === evacuee._id) {
				scanResult = { ...scanResult, evacuee: updated };
			}
			toast.success(`เช็คอิน ${evacuee.first_name} ${evacuee.last_name} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	async function handleCheckOut(evacuee: Evacuee) {
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			const updated = await checkOut.mutateAsync({ evacuee, ctx });
			if (scanResult?.evacuee?._id === evacuee._id) {
				scanResult = { ...scanResult, evacuee: updated };
			}
			toast.success(`เช็คเอาท์ ${evacuee.first_name} ${evacuee.last_name} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาท์ไม่สำเร็จ');
		}
	}

	// Helper for status label translation
	function getStatusLabel(status: StayStatus) {
		const statusLabels: Record<string, string> = {
			pre_registered: 'ลงทะเบียนล่วงหน้า (ยังไม่เช็คอิน)',
			active: 'เช็คอินเข้าพักแล้ว',
			temporary_leave: 'ออกชั่วคราว',
			transferred: 'ย้ายศูนย์พักพิงแล้ว',
			checked_out: 'ย้ายออก/กลับภูมิลำเนาแล้ว',
			deceased: 'เสียชีวิต'
		};
		return statusLabels[status];
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
							class="h-full w-full overflow-hidden rounded-2xl [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
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

				<!-- Scan Result Card -->
				{#if scanResult}
					{@const found = scanResult.success ? scanResult.evacuee : undefined}
					{@const canCheckOut = found?.current_stay ? canCheckOutEvacuee(found) : false}
					{@const canCheckIn = found?.current_stay ? canCheckInEvacuee(found) : false}
					{@const isTerminal = found?.current_stay?.status === 'deceased'}
					<div
						class="mt-6 w-full max-w-sm animate-in overflow-hidden rounded-2xl border shadow-md transition-all duration-200 fade-in slide-in-from-top-2
						{scanResult.success
							? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
							: 'border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-950/10'}"
					>
						{#if scanResult.success && found}
							<!-- Identity header: name + status are the two things staff must confirm at a glance -->
							<div
								class="flex items-start gap-3 px-4 pt-4 pb-3 {canCheckOut
									? 'bg-emerald-500/5'
									: isTerminal
										? 'bg-slate-500/5'
										: 'bg-amber-500/5'}"
							>
								<div
									class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold {canCheckOut
										? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
										: isTerminal
											? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
											: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}"
								>
									{found.first_name.charAt(0)}
								</div>
								<div class="min-w-0 flex-1 pt-0.5">
									<h4 class="truncate text-base font-bold text-slate-900 dark:text-white">
										{found.first_name}
										{found.last_name}
									</h4>
									<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
										<span
											class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold
											{canCheckOut
												? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
												: isTerminal
													? 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
													: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}"
										>
											<span
												class="size-1.5 rounded-full {canCheckOut
													? 'bg-emerald-500'
													: isTerminal
														? 'bg-slate-500'
														: 'bg-amber-500'}"
											></span>
											{found.current_stay
												? getStatusLabel(found.current_stay.status)
												: 'ไม่มีข้อมูลสถานะ'}
										</span>
										{#if found.current_stay?.zone}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300"
											>
												<MapPin class="size-2.5" />
												{found.current_stay.zone}
											</span>
										{/if}
									</div>
								</div>
							</div>

							<!-- Action row: primary tap target sits on the right, within thumb reach -->
							<div
								class="flex items-center gap-2 border-t border-slate-100 p-3 dark:border-slate-800"
							>
								<button
									type="button"
									onclick={() => goto(resolve(`/onsite/people/evacuee-profile-view/${found._id}`))}
									class="flex h-11 shrink-0 items-center gap-0.5 rounded-xl px-2.5 text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
								>
									โปรไฟล์
									<ChevronRight class="size-3.5" />
								</button>

								{#if canCheckOut}
									<Button
										class="h-11 flex-1 gap-1.5 rounded-xl bg-red-600 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.98]"
										onclick={() => handleCheckOut(found)}
										disabled={checkOut.isPending}
									>
										{#if checkOut.isPending}
											<Loader class="size-4 animate-spin" />
										{:else}
											<LogOut class="size-4" />
										{/if}
										เช็คเอาท์
									</Button>
								{:else if canCheckIn}
									<Button
										class="h-11 flex-1 gap-1.5 rounded-xl bg-[#22C55E] text-sm font-bold text-white shadow-sm transition-all hover:bg-[#16A34A] active:scale-[0.98]"
										onclick={() => handleCheckIn(found)}
										disabled={checkIn.isPending}
									>
										{#if checkIn.isPending}
											<Loader class="size-4 animate-spin" />
										{:else}
											<LogIn class="size-4" />
										{/if}
										เช็คอิน
									</Button>
								{:else}
									<Button
										disabled
										class="h-11 flex-1 rounded-xl bg-slate-200 text-sm font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
									>
										ไม่สามารถเปลี่ยนสถานะนี้ได้
									</Button>
								{/if}
							</div>
						{:else}
							<div class="flex items-center gap-2.5 p-4">
								<AlertCircle class="size-5 shrink-0 text-red-500" />
								<div class="min-w-0">
									<p class="text-xs font-bold text-slate-900 dark:text-white">
										{scanResult.message}
									</p>
									<p class="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
										โปรดตรวจสอบข้อมูลรหัสบัตรประชาชน หรือ QR code ของผู้ประสบภัยอีกครั้ง
									</p>
								</div>
							</div>
						{/if}
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

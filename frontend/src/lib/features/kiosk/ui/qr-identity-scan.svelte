<script lang="ts">
	import { tick } from 'svelte';
	import { Html5Qrcode } from 'html5-qrcode';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		lookupBooking,
		type BookingTicketResponse,
		type PublicBookingLookupInput
	} from '$lib/features/public-register';

	interface Props {
		contextQuery: string;
	}

	let { contextQuery }: Props = $props();

	type ScanStep = 'scan' | 'verify' | 'result';
	let step = $state<ScanStep>('scan');
	let cameraError = $state('');
	let scanNotice = $state('');
	let lookupError = $state('');
	let phoneError = $state('');
	let bookingCode = $state('');
	let phone = $state('');
	let isSubmitting = $state(false);
	let cameraAttempt = $state(0);
	let ticket = $state<BookingTicketResponse | null>(null);
	let lastScanTime = 0;
	let isRateLimited = $state(false);

	const backUrl = $derived('/kiosk' + contextQuery);
	const cameraReaderId = 'kiosk-booking-qr-camera-reader';
	const bookingCodePattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

	function focusPhoneInput(node: HTMLElement) {
		void tick().then(() => node.querySelector('input')?.focus());
	}

	function getBookingCode(rawValue: string): string | null {
		const value = rawValue.trim();
		if (!/^evacuee:/i.test(value)) return null;

		const code = value
			.slice(value.indexOf(':') + 1)
			.trim()
			.toUpperCase();
		return bookingCodePattern.test(code) ? code : null;
	}

	function handleScan(decodedValue: string) {
		if (step !== 'scan') return;

		const now = Date.now();
		if (now - lastScanTime < 1500) return;
		lastScanTime = now;

		const code = getBookingCode(decodedValue);
		if (!code) {
			scanNotice = 'QR นี้ไม่ใช่รหัสการจอง SmartShelter กรุณาลองสแกน QR จากบัตรยืนยันการจอง';
			return;
		}

		bookingCode = code;
		scanNotice = '';
		cameraError = '';
		step = 'verify';
		if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
	}

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id);
		let isMounted = true;

		reader
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const size = Math.floor(Math.min(width, height) * 0.72);
						return { width: size, height: size };
					}
				},
				(decodedText) => handleScan(decodedText),
				() => {
					// Ignore frames without a readable QR code.
				}
			)
			.then(() => {
				if (!isMounted && reader.isScanning) reader.stop().catch(() => {});
			})
			.catch(() => {
				if (!isMounted) return;
				cameraError =
					'เปิดกล้องไม่ได้ กรุณาอนุญาตให้เว็บไซต์ใช้กล้อง หรือติดต่อเจ้าหน้าที่ประจำจุด';
			});

		return () => {
			isMounted = false;
			if (reader.isScanning) {
				reader.stop().catch(() => {
					// The camera is released when this step unmounts.
				});
			}
		};
	}

	function retryCamera() {
		cameraError = '';
		scanNotice = '';
		cameraAttempt += 1;
	}

	function returnToScan() {
		step = 'scan';
		bookingCode = '';
		phone = '';
		phoneError = '';
		lookupError = '';
		ticket = null;
		isRateLimited = false;
		retryCamera();
	}

	async function submitLookup(event: SubmitEvent) {
		event.preventDefault();
		phoneError = '';
		lookupError = '';
		isRateLimited = false;

		const normalizedPhone = phone.replace(/\D/g, '');
		if (!/^\d{10}$/.test(normalizedPhone)) {
			phoneError = 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้จองให้ครบ 10 หลัก';
			return;
		}
		if (!bookingCode || isSubmitting) return;

		isSubmitting = true;
		try {
			const input: PublicBookingLookupInput = { code: bookingCode, phone: normalizedPhone };
			ticket = await lookupBooking(input);
			phone = '';
			step = 'result';
		} catch (error) {
			lookupError =
				error instanceof Error ? error.message : 'ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง';
			isRateLimited = lookupError.includes('ถี่เกินไป');
		} finally {
			isSubmitting = false;
		}
	}

	const bookingStatus = $derived.by(() => {
		if (!ticket) return '';
		if (ticket.status === 'pre_registered') return 'ลงทะเบียนล่วงหน้าแล้ว';
		if (ticket.status === 'active') return 'อยู่ระหว่างเข้าพัก';
		if (ticket.status === 'cancelled') return 'รายการจองถูกยกเลิก';
		return 'กรุณาสอบถามเจ้าหน้าที่';
	});
	const isCancelled = $derived(ticket?.status === 'cancelled');
</script>

<svelte:head>
	<title>สแกน QR ยืนยันการจอง — SmartShelter Kiosk</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-6xl flex-col gap-5 lg:gap-7" aria-labelledby="qr-title">
	<div class="relative flex min-h-12 items-center justify-center">
		<Button
			href={backUrl}
			variant="ghost"
			aria-label="กลับไปเลือกวิธียืนยันตัวตน"
			class="absolute top-1/2 left-0 min-h-12 -translate-y-1/2 gap-2 px-2 text-base font-bold text-[#0A2647] hover:bg-[#F0F4F8] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
		>
			<ArrowLeft class="h-5 w-5" aria-hidden="true" />
			<span>กลับ</span>
		</Button>
		<div
			class="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#CBD5E1] bg-[#F0F4F8] px-4 text-sm font-bold text-[#0A2647]"
		>
			<QrCode class="h-5 w-5" aria-hidden="true" />
			<span>{step === 'scan' ? '1 / 2' : '2 / 2'}</span>
		</div>
	</div>

	<header class="mx-auto max-w-3xl text-center">
		<p class="text-sm font-bold tracking-wide text-[#0A2647] sm:text-base">ยืนยันการจองล่วงหน้า</p>
		<h1
			id="qr-title"
			class="mt-1 text-2xl leading-tight font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
		>
			{step === 'scan'
				? 'สแกน QR Code การจอง'
				: step === 'verify'
					? 'ยืนยันเบอร์โทรศัพท์'
					: isCancelled
						? 'โปรดติดต่อเจ้าหน้าที่'
						: 'ยืนยันข้อมูลการจองแล้ว'}
		</h1>
		<p class="mt-2 text-base leading-relaxed text-slate-700 sm:text-lg">
			{step === 'scan'
				? 'เปิด QR จากบัตรยืนยันการจอง แล้ววางให้อยู่ในกรอบ'
				: step === 'verify'
					? 'กรอกเบอร์โทรศัพท์ที่ใช้ลงทะเบียน เพื่อค้นหาข้อมูลการจองอย่างปลอดภัย'
					: isCancelled
						? 'ข้อมูลการจองนี้ถูกยกเลิกแล้ว เจ้าหน้าที่จะช่วยตรวจสอบให้'
						: 'แสดงหน้านี้ให้เจ้าหน้าที่ดู เพื่อดำเนินการขั้นตอนถัดไป'}
		</p>
	</header>

	<ol class="mx-auto grid w-full max-w-2xl grid-cols-2 gap-3" aria-label="ขั้นตอนการยืนยันการจอง">
		<li
			class={[
				'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3',
				step === 'scan'
					? 'border-sky-200 bg-white text-[#0A2647]'
					: 'border-emerald-200 bg-white text-emerald-900'
			]}
		>
			<span
				class={[
					'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
					step === 'scan' ? 'bg-[#0A2647] text-white' : 'bg-emerald-100 text-emerald-900'
				]}
				aria-current={step === 'scan' ? 'step' : undefined}
			>
				{#if step !== 'scan'}<CheckCircle2 class="h-5 w-5" aria-hidden="true" />{:else}1{/if}
			</span>
			<span class="text-sm font-bold sm:text-base">สแกน QR</span>
		</li>
		<li
			class={[
				'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3',
				step !== 'scan'
					? 'border-sky-200 bg-white text-[#0A2647]'
					: 'border-slate-200 bg-white text-slate-600'
			]}
		>
			<span
				class={[
					'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
					step !== 'scan' ? 'bg-[#0A2647] text-white' : 'bg-slate-100 text-slate-600'
				]}
				aria-current={step === 'verify' ? 'step' : undefined}
			>
				{#if step === 'result'}<CheckCircle2 class="h-5 w-5" aria-hidden="true" />{:else}2{/if}
			</span>
			<span class="text-sm font-bold sm:text-base">ยืนยันเบอร์โทรศัพท์</span>
		</li>
	</ol>

	{#if step === 'scan'}
		<div class="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:gap-6">
			<section
				class="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-6"
				aria-labelledby="camera-title"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
						aria-hidden="true"
					>
						<Camera class="h-6 w-6" />
					</div>
					<div>
						<h2 id="camera-title" class="text-lg font-bold text-slate-900 sm:text-xl">
							วาง QR ในกรอบ
						</h2>
						<p class="mt-1 text-sm leading-relaxed text-slate-600">ถือโทรศัพท์หรือกระดาษให้นิ่ง</p>
					</div>
				</div>

				<div
					class="mx-auto mt-4 w-full max-w-[34rem] overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-xs sm:mt-5"
				>
					<div class="relative aspect-[4/3] w-full overflow-hidden">
						{#key cameraAttempt}
							<div
								id={cameraReaderId}
								{@attach cameraAttachment}
								class="absolute inset-0 h-full w-full overflow-hidden [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover!"
								aria-label="ภาพจากกล้องสำหรับสแกน QR Code"
							></div>
						{/key}
						{#if !cameraError}
							<div class="pointer-events-none absolute inset-[10%]" aria-hidden="true">
								<span
									class="absolute top-0 left-0 h-9 w-9 rounded-tl-lg border-t-4 border-l-4 border-white"
								></span>
								<span
									class="absolute top-0 right-0 h-9 w-9 rounded-tr-lg border-t-4 border-r-4 border-white"
								></span>
								<span
									class="absolute bottom-0 left-0 h-9 w-9 rounded-bl-lg border-b-4 border-l-4 border-white"
								></span>
								<span
									class="absolute right-0 bottom-0 h-9 w-9 rounded-br-lg border-r-4 border-b-4 border-white"
								></span>
							</div>
							<div
								class="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-950/70 px-4 py-2 text-center text-sm font-semibold text-white"
							>
								กล้องพร้อมสแกน QR Code
							</div>
						{:else}
							<div
								class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#F8FAFC] px-6 text-center"
							>
								<CameraOff class="h-10 w-10 text-slate-500" aria-hidden="true" />
								<p
									class="max-w-md text-base leading-relaxed font-semibold text-slate-700"
									role="status"
								>
									{cameraError}
								</p>
								<Button
									type="button"
									onclick={retryCamera}
									class="min-h-12 gap-2 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none"
								>
									<RefreshCw class="h-5 w-5" aria-hidden="true" />
									ลองเปิดกล้องอีกครั้ง
								</Button>
							</div>
						{/if}
					</div>
				</div>

				{#if scanNotice}
					<div
						class="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
						role="alert"
					>
						<AlertCircle class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
						<p class="text-sm leading-relaxed font-semibold sm:text-base">{scanNotice}</p>
					</div>
				{/if}

				<p
					class="mt-4 text-center text-sm leading-relaxed text-slate-600 sm:text-base"
					aria-live="polite"
				>
					กล้องจะอ่าน QR ให้อัตโนมัติ ไม่ต้องกดถ่ายภาพ
				</p>
			</section>

			<aside class="space-y-4">
				<section
					class="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-6"
					aria-labelledby="prepare-title"
				>
					<div class="flex items-start gap-3">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
							aria-hidden="true"
						>
							<QrCode class="h-6 w-6" />
						</div>
						<div>
							<h2 id="prepare-title" class="text-lg font-bold text-slate-900 sm:text-xl">
								เตรียมบัตรยืนยันการจอง
							</h2>
							<p class="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
								ใช้ QR จากอีเมล, SMS หรือกระดาษที่พิมพ์ไว้
							</p>
							<p class="mt-3 text-sm leading-relaxed font-semibold text-slate-700">
								หากกล้องอ่านไม่สำเร็จ
							</p>
							<ul class="mt-2 space-y-2 text-sm leading-relaxed text-slate-600 sm:text-base">
								<li class="flex gap-2">
									<span class="font-bold text-[#0A2647]" aria-hidden="true">1.</span><span
										>เพิ่มแสงสว่างและปรับระยะห่างเล็กน้อย</span
									>
								</li>
								<li class="flex gap-2">
									<span class="font-bold text-[#0A2647]" aria-hidden="true">2.</span><span
										>เช็ดเลนส์กล้อง แล้วถือ QR ให้นิ่งในกรอบ</span
									>
								</li>
							</ul>
						</div>
					</div>
				</section>

				<section
					class="rounded-2xl border border-sky-200 bg-white p-5 shadow-2xs sm:p-6"
					aria-labelledby="privacy-title"
				>
					<div class="flex items-start gap-3">
						<ShieldCheck class="mt-0.5 h-6 w-6 shrink-0 text-sky-700" aria-hidden="true" />
						<div>
							<h2 id="privacy-title" class="text-base font-bold text-slate-900 sm:text-lg">
								ข้อมูลของคุณปลอดภัย
							</h2>
							<p class="mt-1 text-sm leading-relaxed text-slate-700">
								ระบบจะยังไม่ค้นหาหรือแสดงข้อมูล จนกว่าจะยืนยันเบอร์โทรศัพท์ที่ใช้จอง
							</p>
							<div class="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
								<LockKeyhole class="h-4 w-4" aria-hidden="true" />
								<span>QR Code เพียงอย่างเดียวใช้เปิดข้อมูลไม่ได้</span>
							</div>
						</div>
					</div>
				</section>

				<p class="flex items-start gap-2 px-1 text-sm leading-relaxed text-slate-600" role="note">
					<CircleHelp class="mt-0.5 h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
					<span>หากไม่มี QR หรือกล้องใช้งานไม่ได้ กรุณาเรียกเจ้าหน้าที่ประจำจุด</span>
				</p>
			</aside>
		</div>
	{:else if step === 'verify'}
		<div
			class="mx-auto grid w-full max-w-4xl items-start gap-4 lg:grid-cols-[0.85fr_1.15fr] lg:gap-6"
		>
			<section
				class="rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xs sm:p-6"
				aria-labelledby="scan-done-title"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"
						aria-hidden="true"
					>
						<CheckCircle2 class="h-6 w-6" />
					</div>
					<div>
						<h2 id="scan-done-title" class="text-lg font-bold text-slate-900 sm:text-xl">
							สแกน QR สำเร็จ
						</h2>
						<p class="mt-1 text-sm text-slate-600">พร้อมตรวจสอบข้อมูลการจอง</p>
					</div>
				</div>
				<div class="mt-5 rounded-xl border border-slate-200 bg-[#F8FAFC] p-4">
					<p class="text-sm font-semibold text-slate-600">ขั้นตอนถัดไป</p>
					<p class="mt-1 text-base leading-relaxed font-bold text-slate-900">
						กรอกเบอร์โทรศัพท์ที่ใช้ลงทะเบียน
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					onclick={returnToScan}
					class="mt-4 min-h-12 w-full gap-2 border-[#CBD5E1] text-base font-bold text-[#0A2647] hover:bg-[#F0F4F8] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					<ArrowLeft class="h-5 w-5" aria-hidden="true" />
					สแกน QR ใหม่
				</Button>
			</section>

			<section
				{@attach focusPhoneInput}
				class="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-7"
				aria-labelledby="phone-title"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
						aria-hidden="true"
					>
						<LockKeyhole class="h-6 w-6" />
					</div>
					<div>
						<h2 id="phone-title" class="text-xl font-bold text-slate-900 sm:text-2xl">
							ยืนยันเบอร์โทรศัพท์
						</h2>
						<p class="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
							ใช้เบอร์เดียวกับที่กรอกตอนจอง
						</p>
					</div>
				</div>

				<form class="mt-6 space-y-4" onsubmit={submitLookup}>
					<div class="space-y-2">
						<label for="booking-phone" class="text-sm font-semibold text-slate-700"
							>เบอร์โทรศัพท์ 10 หลัก</label
						>
						<Input
							id="booking-phone"
							type="tel"
							inputmode="numeric"
							autocomplete="tel"
							maxlength="10"
							pattern="[0-9]{10}"
							placeholder="กรอกเบอร์โทรศัพท์ 10 หลัก"
							bind:value={phone}
							aria-invalid={Boolean(phoneError)}
							aria-describedby="booking-phone-help booking-phone-error"
							class="h-14 rounded-lg border-slate-300 text-lg tracking-wide tabular-nums focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2"
							disabled={isSubmitting}
						/>
						<p id="booking-phone-help" class="text-sm leading-relaxed text-slate-500">
							ตัวเลขจะใช้ค้นหาการจองครั้งนี้เท่านั้น
						</p>
						{#if phoneError}
							<p id="booking-phone-error" class="text-sm font-semibold text-red-700" role="alert">
								{phoneError}
							</p>
						{:else}
							<p id="booking-phone-error" class="sr-only"></p>
						{/if}
					</div>

					{#if lookupError}
						<div
							class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
							role="alert"
							aria-live="assertive"
						>
							<AlertCircle class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
							<div>
								<p class="text-base font-bold">
									{isRateLimited ? 'กรุณารอสักครู่' : 'ตรวจสอบข้อมูลไม่สำเร็จ'}
								</p>
								<p class="mt-1 text-sm leading-relaxed">{lookupError}</p>
							</div>
						</div>
					{/if}

					<Button
						type="submit"
						disabled={isSubmitting}
						class="min-h-14 w-full gap-2 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:text-lg"
					>
						{#if isSubmitting}
							<span
								class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
								aria-hidden="true"
							></span>
							กำลังตรวจสอบข้อมูล…
						{:else}
							ตรวจสอบข้อมูลการจอง
							<ArrowRight class="h-5 w-5" aria-hidden="true" />
						{/if}
					</Button>
				</form>

				<p class="mt-5 flex items-start gap-2 text-sm leading-relaxed text-slate-600">
					<ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
					<span>ข้อมูลการจองจะแสดงหลังจากตรวจสอบรหัส QR และเบอร์โทรศัพท์ตรงกันเท่านั้น</span>
				</p>
			</section>
		</div>
	{:else}
		<section
			class={[
				'mx-auto w-full max-w-2xl rounded-2xl border bg-white p-6 text-center shadow-2xs sm:p-8',
				isCancelled ? 'border-amber-200' : 'border-emerald-200'
			]}
			aria-labelledby="result-title"
			aria-live="polite"
		>
			<div
				class={[
					'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl',
					isCancelled ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
				]}
				aria-hidden="true"
			>
				{#if isCancelled}<AlertCircle class="h-9 w-9" />{:else}<CheckCircle2 class="h-9 w-9" />{/if}
			</div>
			<h2 id="result-title" class="mt-4 text-xl font-extrabold text-[#0A2647] sm:text-2xl">
				{isCancelled ? 'พบข้อมูล แต่รายการจองถูกยกเลิก' : 'ยืนยันข้อมูลการจองแล้ว'}
			</h2>
			{#if ticket}
				<div class="mx-auto mt-5 grid max-w-lg gap-3 text-left sm:grid-cols-2">
					<div class="rounded-xl border border-slate-200 bg-[#F8FAFC] p-4">
						<p class="text-sm font-semibold text-slate-600">ชื่อผู้จอง</p>
						<p class="mt-1 text-lg font-bold text-slate-900">{ticket.first_name || 'ผู้จอง'}</p>
					</div>
					<div class="rounded-xl border border-slate-200 bg-[#F8FAFC] p-4">
						<p class="text-sm font-semibold text-slate-600">สถานะการจอง</p>
						<p class="mt-1 text-lg font-bold text-slate-900">{bookingStatus}</p>
					</div>
					<div class="rounded-xl border border-sky-200 bg-sky-50 p-4 sm:col-span-2">
						<p class="text-sm font-semibold text-sky-900">ศูนย์พักพิง</p>
						<p class="mt-1 text-lg font-bold text-sky-950">{ticket.shelter_name}</p>
					</div>
				</div>
			{/if}
			<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-700">
				{isCancelled
					? 'กรุณาแจ้งเจ้าหน้าที่ประจำจุดเพื่อรับความช่วยเหลือ'
					: 'กรุณาแสดงข้อมูลนี้ให้เจ้าหน้าที่ประจำจุดเพื่อดำเนินการต่อ'}
			</p>
			<Button
				href={backUrl}
				class="mt-6 min-h-12 w-full gap-2 bg-[#0A2647] px-6 text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:w-auto"
			>
				กลับไปหน้าเริ่มต้น
				<ArrowRight class="h-5 w-5" aria-hidden="true" />
			</Button>
		</section>
	{/if}

	<div
		class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-2xs sm:text-base"
	>
		<ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
		<p>ข้อมูลส่วนบุคคลจะแสดงหลังยืนยันตัวตน และจะไม่ถูกบันทึกไว้บนหน้าจอนี้</p>
	</div>
</section>

<style>
	:global(#kiosk-booking-qr-camera-reader *) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}
</style>

<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Search from '@lucide/svelte/icons/search';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Tag from '@lucide/svelte/icons/tag';
	import User from '@lucide/svelte/icons/user';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import X from '@lucide/svelte/icons/x';
	import Zap from '@lucide/svelte/icons/zap';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';

	// ── DEMO VOLUNTEERS DATA ───────────────────────────────────────────────────
	interface DemoShift {
		id: string;
		shiftPeriod: string;
		statusBadge: string;
		statusVariant: 'checked_in' | 'completed' | 'pending';
		title: string;
		description: string;
		location: string;
		dateText: string;
		checkinTime?: string;
		checkoutTime?: string;
		checkinBy?: string;
		canCheckout?: boolean;
		canCancel?: boolean;
	}

	interface DemoVolunteer {
		id: string;
		token: string;
		name: string;
		avatar: string;
		phone: string;
		shelterName: string;
		shelterCode: string;
		verified: boolean;
		statusText: string;
		statusType: 'active' | 'pending' | 'idle';
		roleType: string;
		readiness: boolean;
		scheduleCount: number;
		openingsCount: number;
		shifts: DemoShift[];
	}

	const DEMO_VOLUNTEERS: DemoVolunteer[] = [
		{
			id: 'V-001',
			token: 'PSU-VOL-V-001',
			name: 'นายเก่งกล้า งานอาสา',
			avatar: 'นา',
			phone: '081-9992211',
			shelterName: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			shelterCode: 'PSU',
			verified: true,
			statusText: 'ปฏิบัติหน้าที่อยู่',
			statusType: 'active',
			roleType: '⚡ Operational (จิตอาสาทั่วไป)',
			readiness: true,
			scheduleCount: 2,
			openingsCount: 5,
			shifts: [
				{
					id: 'shift-1',
					shiftPeriod: 'กะเช้า',
					statusBadge: 'เช็คอินเข้างานแล้ว (Checked-In)',
					statusVariant: 'checked_in',
					title: 'ทีมพลบริการช่วยยกของ (Heavy Lifting)',
					description:
						'ช่วยขนย้ายสิ่งของบริจาคเข้าคลังสินค้า จัดเรียงกล่องและแพ็คเสบียงแจกจ่ายน้ำดื่มสำหรับแจกจ่าย',
					location: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
					dateText: '2026-07-17 • 09:00 - 15:00',
					checkinTime: '14:00:00 น.',
					checkinBy: '🏷️ เจ้าหน้าที่เช็คให้',
					canCheckout: true,
					canCancel: true
				},
				{
					id: 'shift-2',
					shiftPeriod: 'กะบ่าย',
					statusBadge: 'เสร็จสิ้นภารกิจแล้ว (Completed)',
					statusVariant: 'completed',
					title: 'ทีมจัดเตรียมและปรุงอาหารร้อน ครัวกลางหาดทอง',
					description:
						'ช่วยหั่นผัก เตรียมวัตถุดิบ บรรจุอาหารกล่องแจกจ่ายให้แก่ผู้ประสบภัยในพื้นที่ศูนย์พักพิงคลองแห',
					location: 'ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)',
					dateText: '2026-06-12 • 12:00 - 18:00',
					checkinTime: '15:53:41 น.',
					checkoutTime: '15:53:42 น.',
					canCheckout: false,
					canCancel: false
				}
			]
		},
		{
			id: 'V-002',
			token: 'PSU-VOL-V-002',
			name: 'นส.ทิพยาพร แสนสุข',
			avatar: 'นส',
			phone: '081-9992222',
			shelterName: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			shelterCode: 'PSU',
			verified: true,
			statusText: 'ปฏิบัติหน้าที่อยู่',
			statusType: 'active',
			roleType: '🛡️ Staff-Capable (ช่วยงานเจ้าหน้าที่)',
			readiness: true,
			scheduleCount: 1,
			openingsCount: 5,
			shifts: [
				{
					id: 'shift-3',
					shiftPeriod: 'กะเช้า',
					statusBadge: 'เช็คอินเข้างานแล้ว (Checked-In)',
					statusVariant: 'checked_in',
					title: 'ทีมอำนวยการและต้อนรับประสานงาน EOC ม.อ.',
					description:
						'ช่วยงานอำนวยการ ต้อนรับผู้ประสานงานจากศูนย์ EOC ม.อ. คัดกรองและประสานงานผู้ประสบภัยที่เดินทางมาถึง',
					location: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
					dateText: '2026-06-13 • 08:00 - 12:00',
					checkinTime: '08:05:12 น.',
					checkinBy: '🏷️ เช็คอินผ่านจุด Station',
					canCheckout: true,
					canCancel: true
				}
			]
		},
		{
			id: 'V-003',
			token: 'KLH-VOL-V-003',
			name: 'นายใจมั่น มั่นคง',
			avatar: 'นา',
			phone: '081-9992233',
			shelterName: 'ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)',
			shelterCode: 'KLONGHAE',
			verified: true,
			statusText: 'รอการมอบหมาย',
			statusType: 'pending',
			roleType: '⚡ Operational (จิตอาสาทั่วไป)',
			readiness: false,
			scheduleCount: 0,
			openingsCount: 5,
			shifts: []
		}
	];

	// ── STATE ──────────────────────────────────────────────────────────────────
	let loginTab = $state<'phone' | 'qr'>('phone');
	let inputPhone = $state('');
	let inputToken = $state('');
	let loginError = $state('');
	let searchDemoQuery = $state('');

	let currentVolunteer = $state<DemoVolunteer | null>(null);
	let dashboardTab = $state<'schedule' | 'openings'>('schedule');
	let searchJobQuery = $state('');
	let selectedShelterFilter = $state('all');
	let isPassModalOpen = $state(false);
	let isCameraModalOpen = $state(false);
	let qrDataUrl = $state<string>('');

	// Generate QR Code data URL when volunteer is active
	$effect(() => {
		if (currentVolunteer) {
			const payload = `SMARTSHELTER:VOLUNTEER:${currentVolunteer.token}:${currentVolunteer.phone}`;
			QRCode.toDataURL(payload, {
				width: 320,
				margin: 1,
				color: { dark: '#0A2647', light: '#ffffff' }
			})
				.then((url) => {
					qrDataUrl = url;
				})
				.catch(() => {
					qrDataUrl = '';
				});
		} else {
			qrDataUrl = '';
		}
	});

	// Filter demo list
	const filteredDemos = $derived(
		DEMO_VOLUNTEERS.filter(
			(d) =>
				d.name.includes(searchDemoQuery.trim()) ||
				d.id.toLowerCase().includes(searchDemoQuery.trim().toLowerCase()) ||
				d.phone.includes(searchDemoQuery.trim())
		)
	);

	function selectDemo(vol: DemoVolunteer) {
		currentVolunteer = JSON.parse(JSON.stringify(vol));
		loginError = '';
		toast.success(`เข้าสู่ระบบในชื่อ ${vol.name}`);
	}

	function handlePhoneLogin(e: SubmitEvent) {
		e.preventDefault();
		loginError = '';
		const trimmed = inputPhone.trim().replace(/[-\s]/g, '');
		if (!trimmed) {
			loginError = 'กรุณากรอกเบอร์โทรศัพท์ที่ลงทะเบียนไว้';
			return;
		}

		const match = DEMO_VOLUNTEERS.find((d) => d.phone.replace(/[-\s]/g, '') === trimmed);
		if (match) {
			currentVolunteer = JSON.parse(JSON.stringify(match));
			toast.success(`เข้าสู่ระบบสำเร็จ: ${match.name}`);
		} else {
			// Auto create quick session for any valid phone
			currentVolunteer = {
				id: `V-${trimmed.slice(-3) || '999'}`,
				token: `VOL-${trimmed}`,
				name: 'จิตอาสา (ลงทะเบียนใหม่)',
				avatar: 'อา',
				phone: inputPhone.trim(),
				shelterName: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
				shelterCode: 'PSU',
				verified: true,
				statusText: 'พร้อมปฏิบัติงาน',
				statusType: 'active',
				roleType: '⚡ Operational (จิตอาสาทั่วไป)',
				readiness: true,
				scheduleCount: 0,
				openingsCount: 5,
				shifts: []
			};
			toast.success('เข้าสู่ระบบสำเร็จ');
		}
	}

	function handleTokenLogin(e: SubmitEvent) {
		e.preventDefault();
		loginError = '';
		const trimmed = inputToken.trim().toUpperCase();
		if (!trimmed) {
			loginError = 'กรุณากรอกรหัส Token หรือรหัสตั๋วจิตอาสา';
			return;
		}

		const match = DEMO_VOLUNTEERS.find(
			(d) => d.token.toUpperCase().includes(trimmed) || d.id.toUpperCase() === trimmed
		);
		if (match) {
			currentVolunteer = JSON.parse(JSON.stringify(match));
			toast.success(`เข้าสู่ระบบสำเร็จ: ${match.name}`);
		} else {
			loginError = 'ไม่พบรหัสตั๋วหรือ Token ในระบบ กรุณาตรวจสอบอีกครั้ง';
		}
	}

	function handleLogout() {
		currentVolunteer = null;
		inputPhone = '';
		inputToken = '';
		loginError = '';
		toast.info('ออกจากระบบแล้ว');
	}

	function toggleReadiness() {
		if (currentVolunteer) {
			currentVolunteer.readiness = !currentVolunteer.readiness;
			toast.success(
				currentVolunteer.readiness
					? 'อัปเดตสถานะ: พร้อมปฏิบัติงาน 🟢'
					: 'อัปเดตสถานะ: พักผ่อน/ไม่พร้อม ⚪'
			);
		}
	}

	function handleCheckOut(shiftId: string) {
		if (!currentVolunteer) return;
		const shift = currentVolunteer.shifts.find((s) => s.id === shiftId);
		if (shift) {
			shift.statusBadge = 'เสร็จสิ้นภารกิจแล้ว (Completed)';
			shift.statusVariant = 'completed';
			shift.checkoutTime = new Date().toLocaleTimeString('th-TH', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
			shift.canCheckout = false;
			shift.canCancel = false;
			toast.success('เช็คเอาต์ออกจากภารกิจเรียบร้อยแล้ว บันทึกเวลาลงระบบ');
		}
	}

	function handleCancelShift(shiftId: string) {
		if (!currentVolunteer) return;
		if (confirm('คุณต้องการขอยกเลิกกะงานนี้ใช่หรือไม่?')) {
			currentVolunteer.shifts = currentVolunteer.shifts.filter((s) => s.id !== shiftId);
			currentVolunteer.scheduleCount = currentVolunteer.shifts.length;
			toast.info('ส่งคำขอยกเลิกกะงานเรียบร้อยแล้ว');
		}
	}

	function handleBookJob(jobTitle: string) {
		toast.success(`จองภารกิจ "${jobTitle}" สำเร็จ! ได้รับตั๋วดิจิทัลแล้ว`);
		if (currentVolunteer) {
			currentVolunteer.scheduleCount += 1;
		}
	}

	function handleRequestReview(jobTitle: string) {
		toast.info(`ยื่นขอปฏิบัติงาน "${jobTitle}" แล้ว รอเจ้าหน้าที่ตรวจสอบคุณสมบัติ`);
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-8">
	<!-- TOP BRAND HEADER -->
	<header class="space-y-3 text-center">
		<div
			class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-2xs font-bold text-amber-700 dark:text-amber-400"
		>
			<Lock class="size-3.5" />
			<span>VOLUNTEER ACCESS PORTAL</span>
		</div>
		<h1 class="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
			เข้าสู่ระบบตารางทำงานจิตอาสา
		</h1>
		<p class="mx-auto max-w-xl text-sm font-medium text-muted-foreground">
			กรุณาระบุหมายเลขโทรศัพท์ หรือสแกน QR Code / กรอกรหัส Token เพื่อเข้าสู่ระบบและจัดการตารางงาน
		</p>
	</header>

	{#if !currentVolunteer}
		<!-- ── NOT SIGNED IN VIEW ───────────────────────────────────────────── -->
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- MAIN LOGIN CARD -->
			<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
				<!-- TAB SWITCHER -->
				<div class="mb-6 flex rounded-2xl bg-muted/40 p-1.5">
					<button
						type="button"
						onclick={() => (loginTab = 'phone')}
						class="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold transition-all md:text-sm {loginTab ===
						'phone'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<Phone class="size-4" />
						<span>เข้าสู่ระบบด้วยเบอร์โทรศัพท์</span>
					</button>

					<button
						type="button"
						onclick={() => (loginTab = 'qr')}
						class="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold transition-all md:text-sm {loginTab ===
						'qr'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<QrCode class="size-4" />
						<span>สแกน QR ตั๋ว / รหัส Token</span>
					</button>
				</div>

				{#if loginTab === 'phone'}
					<!-- TAB 1: PHONE LOGIN -->
					<form onsubmit={handlePhoneLogin} class="space-y-4">
						<div class="space-y-1.5">
							<label for="volunteer-phone-input" class="text-xs font-bold text-foreground">
								หมายเลขโทรศัพท์ที่ลงทะเบียนไว้ <span class="text-destructive">*</span>
							</label>
							<div class="relative">
								<div
									class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground"
								>
									<Phone class="size-4" />
								</div>
								<input
									id="volunteer-phone-input"
									type="tel"
									bind:value={inputPhone}
									placeholder="เช่น 081-234-5678"
									class="w-full rounded-xl border border-border bg-muted/20 py-3.5 pr-4 pl-10 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
							</div>
							<p class="text-2xs text-muted-foreground">
								กรอกเบอร์โทรศัพท์เดียวกันกับที่ลงทะเบียนไว้ในระบบฐานข้อมูลอาสาสมัคร
							</p>
						</div>

						{#if loginError}
							<div
								class="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive"
							>
								<CircleAlert class="size-4 shrink-0" />
								<span>{loginError}</span>
							</div>
						{/if}

						<button
							type="submit"
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99]"
						>
							<Rocket class="size-4" />
							<span>เข้าสู่ระบบทันที</span>
						</button>
					</form>
				{:else}
					<!-- TAB 2: QR & TOKEN LOGIN -->
					<div class="space-y-6">
						<form onsubmit={handleTokenLogin} class="space-y-2">
							<label for="volunteer-token-input" class="text-xs font-bold text-foreground">
								กรอกรหัส Token หรือ รหัสตั๋วจิตอาสา
							</label>
							<div class="flex gap-2">
								<input
									id="volunteer-token-input"
									type="text"
									bind:value={inputToken}
									placeholder="เช่น TKT-VOL-1001 หรือ V-1001"
									class="flex-1 rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
								<button
									type="submit"
									class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-95"
								>
									<Rocket class="size-3.5" />
									<span>เข้าสู่ระบบ</span>
								</button>
							</div>
						</form>

						<div class="relative flex items-center justify-center">
							<div class="w-full border-t border-border"></div>
							<span class="absolute bg-card px-3 text-2xs font-bold text-muted-foreground">หรือ</span
							>
						</div>

						<!-- QR SCANNER SECTION -->
						<div class="space-y-4 text-center">
							<p class="text-xs font-bold text-foreground">สแกน QR Code ตั๋วประจำตัวอาสาสมัคร</p>
							<div
								class="mx-auto flex size-20 items-center justify-center rounded-2xl border border-sky-200/60 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400"
							>
								<QrCode class="size-10" />
							</div>

							<button
								type="button"
								onclick={() => (isCameraModalOpen = true)}
								class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99]"
							>
								<Camera class="size-4" />
								<span>เปิดกล้องสแกน QR Code ตั๋ว</span>
							</button>
						</div>

						{#if loginError}
							<div
								class="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive"
							>
								<CircleAlert class="size-4 shrink-0" />
								<span>{loginError}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- DEMO QUICK SELECT BOX -->
			<div
				class="rounded-3xl border-2 border-amber-300 bg-amber-50/40 p-5 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/20 md:p-6"
			>
				<div class="mb-3 flex items-center justify-between gap-2">
					<div
						class="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1 text-2xs font-bold text-white shadow-xs"
					>
						<Zap class="size-3.5 fill-white" />
						<span>DEMO QUICK SELECT โหมดสาธิตสำหรับทดสอบระบบ</span>
					</div>
					<span
						class="rounded-md bg-amber-200 px-2 py-0.5 text-3xs font-black text-amber-900 dark:bg-amber-900 dark:text-amber-200"
					>
						DEMO ONLY
					</span>
				</div>

				<p class="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
					⚠️ <strong>ทางลัดสำหรับผู้ทดสอบระบบ:</strong>
					คุณสามารถกดเลือกบัญชีจิตอาสาตัวอย่างด้านล่างนี้เพื่อสลับโปรไฟล์เข้าดูตารางและลองเช็คอินได้ทันทีโดยไม่ต้องผ่าน
					OTP
				</p>

				<!-- Demo Search Filter -->
				<div class="relative my-3">
					<Search
						class="pointer-events-none absolute top-3 left-3.5 size-3.5 text-muted-foreground"
					/>
					<input
						type="text"
						bind:value={searchDemoQuery}
						placeholder="ค้นหาชื่อ หรือรหัสจิตอาสาตัวอย่าง..."
						class="w-full rounded-xl border border-amber-200 bg-card py-2.5 pr-4 pl-9 text-xs text-foreground outline-hidden focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-amber-800"
					/>
				</div>

				<!-- Demo List Items -->
				<div class="space-y-2.5">
					{#each filteredDemos as demo (demo.id)}
						<button
							type="button"
							onclick={() => selectDemo(demo)}
							class="group flex w-full cursor-pointer items-center justify-between rounded-2xl border border-amber-200/80 bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-sm dark:border-amber-800/80"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
								>
									{demo.avatar}
								</div>
								<div>
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="text-xs font-bold text-foreground md:text-sm">{demo.name}</span>
										<span class="text-2xs font-semibold text-destructive">({demo.id})</span>
									</div>
									<p class="flex items-center gap-1 text-2xs text-muted-foreground">
										<MapPin class="size-3 shrink-0" />
										<span class="truncate">{demo.shelterName}</span>
									</p>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<div class="hidden flex-col items-end gap-1 sm:flex">
									<span
										class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										<CircleCheck class="size-2.5" /> ยืนยันตัวตนแล้ว
									</span>
									<span
										class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										{demo.statusText}
									</span>
								</div>
								<ChevronRight
									class="size-4 text-muted-foreground transition-transform group-hover:translate-x-1"
								/>
							</div>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{:else}
		<!-- ── SIGNED IN VOLUNTEER DASHBOARD ─────────────────────────────────── -->

		<!-- TOP PROFILE HEADER CARD -->
		<div
			class="flex flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center"
		>
			<!-- Left: Avatar + Details -->
			<div class="flex items-start gap-4">
				<div
					class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-md"
				>
					{currentVolunteer.avatar}
				</div>
				<div class="space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-lg font-black text-foreground md:text-xl">{currentVolunteer.name}</h2>
						<span
							class="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-2xs font-bold text-muted-foreground"
						>
							ID: {currentVolunteer.id}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
						>
							<CircleCheck class="size-3" /> ยืนยันตัวตนแล้ว
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
						>
							{currentVolunteer.statusText}
						</span>
					</div>

					<p class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
						<span class="flex items-center gap-1">
							<MapPin class="size-3.5 text-primary" /> สังกัด: {currentVolunteer.shelterName}
						</span>
						<span>📞 {currentVolunteer.phone}</span>
					</p>

					<div class="pt-1">
						<span
							class="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-2xs font-bold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
						>
							{currentVolunteer.roleType}
						</span>
					</div>
				</div>
			</div>

			<!-- Right: Readiness Toggle + Actions -->
			<div class="flex flex-wrap items-center gap-3">
				<!-- Status Toggle -->
				<div class="flex rounded-xl border border-border bg-muted/30 p-1">
					<button
						type="button"
						onclick={toggleReadiness}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {currentVolunteer.readiness
							? 'border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-xs dark:bg-emerald-950/80 dark:text-emerald-200'
							: 'text-muted-foreground'}"
					>
						<span class="size-2 rounded-full bg-emerald-500"></span>
						<span>พร้อมปฏิบัติงาน</span>
					</button>
					<button
						type="button"
						onclick={toggleReadiness}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {!currentVolunteer.readiness
							? 'border border-border bg-card text-foreground shadow-xs'
							: 'text-muted-foreground'}"
					>
						<span class="size-2 rounded-full bg-muted-foreground"></span>
						<span>พักผ่อน/ไม่พร้อม</span>
					</button>
				</div>

				<button
					type="button"
					onclick={() => toast.info('ระบบแก้ไขโปรไฟล์จะเปิดให้บริการในอัปเดตถัดไป')}
					class="rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
				>
					แก้ไขโปรไฟล์
				</button>

				<button
					type="button"
					onclick={handleLogout}
					title="สลับบัญชี / ออกจากระบบ"
					class="flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
				>
					<LogOut class="size-4" />
				</button>
			</div>
		</div>

		<!-- PRIMARY TABS -->
		<div class="flex border-b border-border">
			<div class="inline-flex rounded-t-2xl border-x border-t border-border/60 bg-muted/20 p-1">
				<button
					type="button"
					onclick={() => (dashboardTab = 'schedule')}
					class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all {dashboardTab ===
					'schedule'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<ClipboardList class="size-4" />
					<span>ตารางของฉัน</span>
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-black text-primary dark:bg-primary/30"
					>
						{currentVolunteer.scheduleCount}
					</span>
				</button>

				<button
					type="button"
					onclick={() => (dashboardTab = 'openings')}
					class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all {dashboardTab ===
					'openings'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<Rocket class="size-4" />
					<span>ตลาดงานจิตอาสา (Openings)</span>
					<span
						class="rounded-full bg-amber-500/20 px-2 py-0.5 text-3xs font-black text-amber-800 dark:text-amber-300"
					>
						{currentVolunteer.openingsCount}
					</span>
				</button>
			</div>
		</div>

		{#if dashboardTab === 'schedule'}
			<!-- ── TAB 1: MY SCHEDULE ──────────────────────────────────────── -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<!-- Left 2 Cols: Shift Tasks List -->
				<div class="space-y-4 lg:col-span-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-bold text-foreground md:text-base">รายการภารกิจปฏิบัติการ</h3>
						<span class="text-2xs text-muted-foreground">แสดงเฉพาะงานทั้งหมดที่ลงทะเบียนแล้ว</span>
					</div>

					{#if currentVolunteer.shifts.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<ClipboardList class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">ยังไม่มีรายการภารกิจที่ลงทะเบียน</p>
							<p class="mt-1 text-xs">คุณสามารถเลือกดูงานที่เปิดรับได้ที่แท็บ "ตลาดงานจิตอาสา"</p>
							<button
								type="button"
								onclick={() => (dashboardTab = 'openings')}
								class="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95"
							>
								ดูตลาดงานจิตอาสา
							</button>
						</div>
					{:else}
						{#each currentVolunteer.shifts as shift (shift.id)}
							<div
								class="rounded-3xl border bg-card p-6 shadow-sm transition-all hover:shadow-md {shift.statusVariant ===
								'checked_in'
									? 'border-l-4 border-l-emerald-500 border-border'
									: 'border-border'}"
							>
								<div class="flex flex-col justify-between gap-4 md:flex-row md:items-start">
									<div class="space-y-2">
										<div class="flex flex-wrap items-center gap-2">
											<span
												class="rounded-md bg-sky-50 px-2 py-0.5 text-2xs font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
											>
												{shift.shiftPeriod}
											</span>
											<span
												class="rounded-md px-2 py-0.5 text-2xs font-bold {shift.statusVariant ===
												'checked_in'
													? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
													: 'bg-muted text-muted-foreground'}"
											>
												{shift.statusBadge}
											</span>
										</div>

										<h4 class="text-base font-bold text-foreground">{shift.title}</h4>
										<p class="text-xs leading-relaxed text-muted-foreground">
											{shift.description}
										</p>

										<div
											class="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground"
										>
											<span class="flex items-center gap-1 font-medium text-foreground">
												<MapPin class="size-3 text-primary" />
												{shift.location}
											</span>
											<span class="flex items-center gap-1">
												<Clock class="size-3" />
												{shift.dateText}
											</span>
										</div>

										<!-- Checkin info -->
										<div
											class="flex flex-wrap items-center gap-3 pt-1 text-2xs text-muted-foreground"
										>
											{#if shift.checkinTime}
												<span class="flex items-center gap-1 font-medium text-emerald-700">
													<Clock class="size-3" /> เช็คอิน: {shift.checkinTime}
												</span>
											{/if}
											{#if shift.checkoutTime}
												<span class="flex items-center gap-1 font-medium text-muted-foreground">
													<Clock class="size-3" /> เช็คเอาต์: {shift.checkoutTime}
												</span>
											{/if}
											{#if shift.checkinBy}
												<span class="font-medium text-muted-foreground">{shift.checkinBy}</span>
											{/if}
										</div>
									</div>

									<!-- Actions -->
									<div class="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
										{#if shift.canCheckout}
											<button
												type="button"
												onclick={() => handleCheckOut(shift.id)}
												class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-95"
											>
												<Clock class="size-3.5" />
												<span>เช็คเอาต์ออกจากงาน (Check-Out)</span>
											</button>
										{/if}

										{#if shift.canCancel}
											<button
												type="button"
												onclick={() => handleCancelShift(shift.id)}
												class="rounded-xl border border-border px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
											>
												ขอยกเลิกกะงาน
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Right 1 Col: Widgets -->
				<div class="space-y-6">
					<!-- WIDGET 1: กติกาการเข้ากะ -->
					<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
						<h4 class="flex items-center gap-2 text-sm font-bold text-foreground">
							<span>📢</span> กติกาการเข้ากะ
						</h4>
						<ul class="mt-3.5 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>กรุณารายงานตัว Check-in ทันทีเมื่อเดินทางมาถึงศูนย์พักพิง</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span
									>เมื่อปฏิบัติภารกิจเสร็จสิ้นตามกรอบเวลา ให้กดปุ่ม Check-out
									เพื่อสะสมเวลาปฏิบัติงานและคืนข้อมูลทรัพยากร</span
								>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span
									>หากเกิดเหตุฉุกเฉินหรือไม่สามารถเข้าปฏิบัติการได้ตามกำหนด
									ให้กดคำขอยกเลิกเพื่อให้ผู้จัดการศูนย์พิจารณา</span
								>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>ไม่มีการแชร์ข้อมูลส่วนบุคคลของผู้ประสบภัยเพื่อความปลอดภัยของระบบ</span>
							</li>
						</ul>
					</div>

					<!-- WIDGET 2: บัตรอาสาสมัครอัจฉริยะ (QR Role Card) -->
					<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="flex items-center justify-between">
							<h4 class="text-xs font-bold text-foreground">
								บัตรอาสาสมัครอัจฉริยะ (QR Role Card)
							</h4>
							<button
								type="button"
								onclick={() => (isPassModalOpen = true)}
								class="flex items-center gap-1 text-2xs font-bold text-primary hover:underline"
							>
								<Maximize2 class="size-3" /> ขยายบัตร
							</button>
						</div>
						<p class="mt-2 text-2xs text-muted-foreground">
							คุณสามารถรับสิทธิสวัสดิการ อาหารร้อน น้ำดื่ม และเวชภัณฑ์ที่เจ้าหน้าที่จัดเตรียมไว้
							โดยใช้บัตรนี้แสดงต่อเจ้าหน้าที่ ณ จุดแจกจ่าย
						</p>

						<!-- Mini QR Role Card -->
						<div
							class="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-center transition-all hover:bg-muted/30"
						>
							{#if qrDataUrl}
								<img
									src={qrDataUrl}
									alt="QR Code"
									class="mx-auto size-28 rounded-xl border border-border bg-white p-1.5 shadow-xs"
								/>
							{:else}
								<div
									class="mx-auto flex size-28 items-center justify-center rounded-xl bg-white text-muted-foreground"
								>
									<QrCode class="size-16" />
								</div>
							{/if}
							<h5 class="mt-2.5 text-xs font-black text-foreground">{currentVolunteer.name}</h5>
							<p class="text-2xs font-semibold text-muted-foreground">{currentVolunteer.token}</p>
							<div class="mt-2 flex justify-center gap-1">
								<span
									class="rounded bg-emerald-50 px-1.5 py-0.5 text-3xs font-bold text-emerald-700"
								>
									🟢 ยืนยันตัวตนแล้ว
								</span>
								<span
									class="rounded bg-emerald-50 px-1.5 py-0.5 text-3xs font-bold text-emerald-700"
								>
									🟢 ปฏิบัติหน้าที่อยู่
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- ── TAB 2: JOB OPENINGS (ตลาดงานจิตอาสา) ─────────────────────── -->
			<div class="space-y-6">
				<!-- Search & Filter Bar -->
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					<div class="relative flex-1">
						<Search
							class="pointer-events-none absolute top-3 left-3.5 size-4 text-muted-foreground"
						/>
						<input
							type="text"
							bind:value={searchJobQuery}
							placeholder="ค้นหาภารกิจที่เหมาะสมกับทักษะ..."
							class="w-full rounded-xl border border-border bg-card py-2.5 pr-4 pl-10 text-xs font-medium text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary md:text-sm"
						/>
					</div>

					<select
						bind:value={selectedShelterFilter}
						class="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground outline-hidden focus:ring-1 focus:ring-primary sm:w-64"
					>
						<option value="all">ทุกศูนย์พักพิง</option>
						<option value="psu">มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)</option>
						<option value="hatyai">ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
						<option value="klonghae">ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
					</select>
				</div>

				<!-- Job Cards 2-Column Grid -->
				<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<!-- JOB CARD 1: EOC COORDINATOR (Controlled Skill) -->
					<div class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									มหาวิทยาลัยสงขลานครินทร์ (ศูนย์...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-rose-50 px-2 py-0.5 text-3xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
									>
										ระดับหัวหน้า/ผู้คุมสายงาน
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมอำนวยการและต้อนรับประสานงาน EOC ม.อ.
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ช่วยงานอำนวยการ ต้อนรับผู้ประสานงานจากศูนย์ EOC ม.อ.
								คัดกรองและประสานงานผู้ประสบภัยที่เดินทางมาถึง
							</p>

							<!-- Staff-Capable Notice Box -->
							<div
								class="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800 dark:bg-sky-950/40"
							>
								<div class="flex items-start gap-2">
									<Shield class="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-400" />
									<p class="text-2xs leading-relaxed text-sky-900 dark:text-sky-200">
										<strong>ภารกิจระดับเจ้าหน้าที่ (Staff-Capable) / ทักษะพิเศษ:</strong>
										จิตอาสาทั่วไปสามารถกด "ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)"
										เพื่อให้เจ้าหน้าที่ตรวจสอบคุณสมบัติและตรวจบัตรประชาชนตัวจริงหน้างานได้
									</p>
								</div>
							</div>

							<div class="flex flex-wrap gap-1.5">
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ สื่อสารและประสานงานทั่วไป
								</span>
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ Communications
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-13
									<span class="rounded bg-sky-100 px-1.5 py-0.2 text-3xs text-sky-800">กะเช้า</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 0%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 100%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 39 <span class="text-2xs">(เป้า 18 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								onclick={() => handleRequestReview('ทีมอำนวยการและต้อนรับประสานงาน EOC ม.อ.')}
								class="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
							>
								<span>📝 ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 2: HEAVY LIFTING SANDBAGS (Operational) -->
					<div class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									ศูนย์พักพิง เทศบาลนครหาดใหญ่ (...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										ระดับปฏิบัติการ (Operational)
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมพลบริการช่วยยกของ ย้ายกระสอบทรายติดตั้งริมหาด
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ต้องการทีมพลบริการช่วยขนย้ายกระสอบทรายลงเครื่องริมหาดเร่งด่วนเพื่อป้องกันน้ำท่วมเข้าพื้นที่ศูนย์
							</p>

							<div class="flex flex-wrap gap-1.5">
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ งานกำลังกาย / แบกหาม
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-13
									<span class="rounded bg-sky-100 px-1.5 py-0.2 text-3xs text-sky-800">กะเช้า</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 0%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 100%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 15 <span class="text-2xs">(เป้า 15 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								onclick={() =>
									handleBookJob('ทีมพลบริการช่วยยกของ ย้ายกระสอบทรายติดตั้งริมหาด')}
								class="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground shadow-md transition-all hover:opacity-95"
							>
								<Rocket class="size-3.5" />
								<span>จองภารกิจนี้</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 3: KITCHEN (Registered Already) -->
					<div class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									ศูนย์พักพิง เทศบาลเมืองคลองแห (...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										ระดับปฏิบัติการ (Operational)
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมจัดเตรียมและปรุงอาหารร้อน ครัวกลางหาดทอง
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ช่วยหั่นผัก เตรียมวัตถุดิบ บรรจุอาหารกล่องแจกจ่ายให้แก่ผู้ประสบภัยในพื้นที่ศูนย์พักพิงคลองแห
							</p>

							<div class="flex flex-wrap gap-1.5">
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ ประกอบอาหาร / ครัวกลาง
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-12
									<span class="rounded bg-sky-100 px-1.5 py-0.2 text-3xs text-sky-800">กะบ่าย</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 12:00 - 18:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 37.5%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 62.5%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 3</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 7 <span class="text-2xs">(เป้า 8 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								disabled
								class="mt-3.5 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-emerald-100 py-2.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
							>
								<Check class="size-3.5" />
								<span>ลงทะเบียนแล้ว</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 4: REGISTRATION & SCREENING (Time Collision Demo) -->
					<div class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									มหาวิทยาลัยสงขลานครินทร์ (ศูนย์...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-rose-50 px-2 py-0.5 text-3xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
									>
										ระดับหัวหน้า/ผู้คุมสายงาน
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								เจ้าหน้าที่คัดกรองผู้ประสบภัย (Registration & Screening)
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ต้อนรับผู้ประสบภัย สอบถามข้อมูลเบื้องต้นและลงทะเบียนเข้าระบบของศูนย์พักพิง
								พร้อมคัดกรองเบื้องต้น
							</p>

							<!-- Staff-Capable Notice Box -->
							<div
								class="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800 dark:bg-sky-950/40"
							>
								<div class="flex items-start gap-2">
									<Shield class="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-400" />
									<p class="text-2xs leading-relaxed text-sky-900 dark:text-sky-200">
										<strong>ภารกิจระดับเจ้าหน้าที่ (Staff-Capable) / ทักษะพิเศษ:</strong>
										จิตอาสาทั่วไปสามารถกด "ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)"
										เพื่อให้เจ้าหน้าที่ตรวจสอบคุณสมบัติและตรวจบัตรประชาชนตัวจริงหน้างานได้
									</p>
								</div>
							</div>

							<div class="flex flex-wrap gap-1.5">
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ สื่อสารและประสานงานทั่วไป
								</span>
								<span class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
									🏷️ Communication
								</span>
							</div>
						</div>

						<!-- Two Shift Slots with Collision Warning -->
						<div class="mt-5 space-y-3">
							<!-- Slot 1 -->
							<div
								class="rounded-2xl border border-amber-300/80 bg-amber-50/30 p-4 dark:border-amber-700 dark:bg-amber-950/20"
							>
								<div class="flex items-center justify-between text-xs font-bold">
									<span class="flex items-center gap-1.5 text-foreground">
										📅 2026-07-17
										<span class="rounded bg-sky-100 px-1.5 py-0.2 text-3xs text-sky-800">กะเช้า</span>
									</span>
									<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
								</div>

								<div class="mt-2.5 space-y-1">
									<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
										<div class="bg-emerald-500" style="width: 25%"></div>
										<div class="bg-amber-400" style="width: 0%"></div>
										<div class="bg-border" style="width: 75%"></div>
									</div>
									<div class="flex justify-between text-3xs text-muted-foreground">
										<span class="text-emerald-700">🟢 ตอบรับแล้ว: 1</span>
										<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
										<span>⚪ ยังขาดอีก: 3 <span class="text-2xs">(เป้า 4 คน)</span></span>
									</div>
								</div>

								<button
									type="button"
									disabled
									class="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/70 py-2.5 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
								>
									<AlertTriangle class="size-3.5" />
									<span>เวลาชนกับกะที่จองไว้</span>
								</button>
								<p class="mt-1.5 text-center text-3xs text-amber-800 dark:text-amber-300">
									⚠️ ชนกับภารกิจ "ทีมพลบริการช่วยยกของ (Heavy Lifting)" ในช่วงเวลา 09:00 - 15:00 น. แล้ว
								</p>
							</div>

							<!-- Slot 2 -->
							<div
								class="rounded-2xl border border-amber-300/80 bg-amber-50/30 p-4 dark:border-amber-700 dark:bg-amber-950/20"
							>
								<div class="flex items-center justify-between text-xs font-bold">
									<span class="flex items-center gap-1.5 text-foreground">
										📅 2026-07-17
										<span class="rounded bg-sky-100 px-1.5 py-0.2 text-3xs text-sky-800">กะบ่าย</span>
									</span>
									<span class="text-2xs text-muted-foreground">🕒 12:00 - 18:00 น.</span>
								</div>

								<div class="mt-2.5 space-y-1">
									<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
										<div class="bg-emerald-500" style="width: 0%"></div>
										<div class="bg-amber-400" style="width: 0%"></div>
										<div class="bg-border" style="width: 100%"></div>
									</div>
									<div class="flex justify-between text-3xs text-muted-foreground">
										<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
										<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
										<span>⚪ ยังขาดอีก: 4 <span class="text-2xs">(เป้า 4 คน)</span></span>
									</div>
								</div>

								<button
									type="button"
									disabled
									class="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/70 py-2.5 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
								>
									<AlertTriangle class="size-3.5" />
									<span>เวลาชนกับกะที่จองไว้</span>
								</button>
								<p class="mt-1.5 text-center text-3xs text-amber-800 dark:text-amber-300">
									⚠️ ชนกับภารกิจ "ทีมพลบริการช่วยยกของ (Heavy Lifting)" ในช่วงเวลา 09:00 - 15:00 น. แล้ว
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- ── MODAL: CAMERA QR SCANNER ────────────────────────────────────────────── -->
{#if isCameraModalOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
	>
		<div class="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-bold text-foreground">สแกน QR Code ตั๋วจิตอาสา</h3>
				<button
					type="button"
					onclick={() => (isCameraModalOpen = false)}
					class="size-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="my-6 rounded-2xl border-2 border-dashed border-primary/50 bg-muted/20 p-8 text-center">
				<Camera class="mx-auto size-12 text-primary animate-pulse" />
				<p class="mt-3 text-xs font-bold text-foreground">กำลังเชื่อมต่อกล้องอุปกรณ์...</p>
				<p class="mt-1 text-2xs text-muted-foreground">หันกล้องไปยัง QR Code บนตั๋วดิจิทัลหรือบัตรงาน</p>
			</div>

			<div class="space-y-2">
				<button
					type="button"
					onclick={() => {
						isCameraModalOpen = false;
						selectDemo(DEMO_VOLUNTEERS[0]);
					}}
					class="w-full rounded-xl bg-primary py-3 text-xs font-bold text-white shadow hover:opacity-95"
				>
					จำลองการสแกนสำเร็จ (V-001)
				</button>
				<button
					type="button"
					onclick={() => (isCameraModalOpen = false)}
					class="w-full rounded-xl border border-border py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── MODAL: DIGITAL PASS VIEW ───────────────────────────────────────────── -->
{#if isPassModalOpen && currentVolunteer}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
	>
		<div class="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl text-center">
			<div class="flex justify-end">
				<button
					type="button"
					onclick={() => (isPassModalOpen = false)}
					class="size-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="space-y-3">
				<div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-white font-black text-lg">
					{currentVolunteer.avatar}
				</div>
				<h3 class="text-base font-black text-foreground">{currentVolunteer.name}</h3>
				<p class="text-xs text-muted-foreground font-mono">{currentVolunteer.token}</p>

				{#if qrDataUrl}
					<img
						src={qrDataUrl}
						alt="QR Code Pass"
						class="mx-auto size-48 rounded-2xl border-2 border-primary/20 bg-white p-2 shadow-md"
					/>
				{/if}

				<div class="flex justify-center gap-1.5 pt-1">
					<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700">
						🟢 ยืนยันตัวตนแล้ว
					</span>
					<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700">
						🟢 ปฏิบัติหน้าที่อยู่
					</span>
				</div>

				<p class="text-2xs text-muted-foreground">
					ยื่นแสดง QR Code นี้ต่อเจ้าหน้าที่ ณ จุดสแกนเช็คอินศูนย์พักพิง
				</p>

				<button
					type="button"
					onclick={() => (isPassModalOpen = false)}
					class="mt-2 w-full rounded-xl bg-primary py-3 text-xs font-bold text-white shadow hover:opacity-95"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}

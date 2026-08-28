<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import FileText from '@lucide/svelte/icons/file-text';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Heart from '@lucide/svelte/icons/heart';
	import Info from '@lucide/svelte/icons/info';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';
	import { goto } from '$app/navigation';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import { resolve } from '$app/paths';
	import {
		VolunteerSchedule,
		ticketFindSchema,
		ticketStatusLabel,
		useVolunteerTickets
	} from '$lib/features/volunteers';

	let activeTab = $state('register'); // register | portal | needs

	// ── Volunteer Access Portal (tab 2, CR-092 หน้าจอ 6) ──────────────────────────
	// Sign-in is by the phone number the volunteer applied with, or by a ticket code.
	// There is no account and no password: an operational volunteer never gets a login
	// (CR-092 §2.1.1), so the phone number is the key.

	/** What is typed into the box — a phone number or a ticket code. */
	let portalInput = $state('');
	/**
	 * The number the session is signed in as. Held in component state only, never in
	 * localStorage: this page is meant to be opened on a volunteer's own phone *and* on
	 * a shelter's shared tablet, and remembering the last person's number on the shared
	 * one would hand their schedule to whoever picks it up next.
	 */
	let portalPhone = $state('');
	let portalError = $state('');

	const portalTickets = useVolunteerTickets(() => portalPhone);

	/** Ticket codes are prefixed; anything else is treated as a phone number. */
	function looksLikeTicketCode(value: string): boolean {
		const upper = value.trim().toUpperCase();
		return upper.startsWith('TKT-VOL-') || upper.startsWith('VIEW-');
	}

	function portalSignIn(event: SubmitEvent) {
		event.preventDefault();
		portalError = '';
		const value = portalInput.trim();
		if (!value) {
			portalError = 'กรุณากรอกเบอร์โทรศัพท์ หรือรหัสตั๋วจิตอาสา';
			return;
		}
		if (looksLikeTicketCode(value)) {
			// A code opens the pass straight away — it needs no lookup, and the pass is
			// where the QR for on-site check-in lives.
			void goto(resolve(`/volunteer/ticket/${encodeURIComponent(value)}`));
			return;
		}
		const parsed = ticketFindSchema.safeParse({ phone: value });
		if (!parsed.success) {
			portalError = parsed.error.issues[0]?.message ?? 'เบอร์โทรศัพท์ไม่ถูกต้อง';
			return;
		}
		// The normalised form, so the query key matches whatever separators were typed.
		portalPhone = parsed.data.phone;
	}

	function portalSignOut() {
		portalPhone = '';
		portalInput = '';
		portalError = '';
	}
</script>

<svelte:head>
	<title>ระบบงานข้อมูลอาสาสมัคร — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<PublicHeroMetrics
		title="ระบบงานข้อมูลอาสาสมัครร่วมบูรณาการภัยพิบัติ"
		description="เชื่อมประสานความดี ขจัดปัญหาร่วมกระจุกตัว ด้วยการคัดกรองทักษะ (Skill Matching) ออกรหัสลงทะเบียน (Role Card) ปฏิบัติอาสา และติดตามสวัสดิการตามมาตรฐาน Sphere"
		badgeText="Rescue Volunteer Platform"
		badgeIcon={UserPlus}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Tab Bar Navigation -->
	<div class="flex justify-start border-b border-border">
		<div class="inline-flex rounded-t-xl border-x border-t border-border/50 bg-muted/30 p-1">
			<button
				onclick={() => (activeTab = 'register')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'register'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<UserPlus class="h-3.5 w-3.5" />
				รวมสมัครพลังอาสา
			</button>
			<button
				onclick={() => (activeTab = 'portal')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'portal'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<QrCode class="h-3.5 w-3.5" />
				พอร์ทัล & บัตรงานอาสา
			</button>
			<button
				onclick={() => (activeTab = 'needs')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'needs'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				ประกาศความต้องการกำลังพล
			</button>
		</div>
	</div>

	<!-- TAB 1: รวมสมัครพลังอาสา -->
	{#if activeTab === 'register'}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Form area -->
			<div class="lg:col-span-2">
				<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
					<h2 class="text-base font-bold text-foreground">1. ลงทะเบียนร่วมเป็นกำลังอาสา</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						เมื่อผ่านขบวนลงทะเบียน ระบบจะออกรหัสประจำตัวอาสาสำหรับใช้เช็คอิน และแจกจ่ายบัตรงาน Role
						Card หน้าจุดในทันที
					</p>

					<form onsubmit={(e) => e.preventDefault()} class="mt-6 space-y-5">
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="fullname"
									>ชื่อ-นามสกุล ของท่าน</label
								>
								<input
									id="fullname"
									type="text"
									placeholder="ระบุชื่อจริง นามสกุล"
									class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
							</div>
							<div class="flex flex-col gap-1.5">
								<label class="text-xs font-bold text-foreground" for="emergency-phone"
									>เบอร์ติดต่อกรณีฉุกเฉิน</label
								>
								<input
									id="emergency-phone"
									type="text"
									placeholder="08X-XXX-XXXX"
									class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shelter"
								>ศูนย์พักพิงที่ต้องการเข้าช่วย</label
							>
							<select
								id="shelter"
								class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
							>
								<option>ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
								<option>ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
							</select>
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="text-xs font-bold text-foreground" for="shift"
								>กะการเข้าร่วมช่วยเหลือ (Shift)</label
							>
							<select
								id="shift"
								class="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
							>
								<option>กะเช้า (08:00 - 16:00)</option>
								<option>กะบ่าย (16:00 - 00:00)</option>
								<option>กะดึก (00:00 - 08:00)</option>
							</select>
						</div>

						<!-- Skills checklist with visual boxes -->
						<div>
							<span class="mb-3 block text-xs font-bold text-foreground"
								>ทักษะที่เกี่ยวข้องของตัวท่าน (รับเฉพาะเกณฑ์คัดกรอง)</span
							>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<ChefHat class="h-3.5 w-3.5 text-warning" />
											ประกอบอาหาร (Cooking)
										</span>
										<p class="mt-1 text-2xs text-muted-foreground">
											ศูนย์ขาดแคลนกำลังทำอาหารจำนวนมาก
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<Ambulance class="h-3.5 w-3.5 text-danger" />
											การแพทย์/ปฐมพยาบาล (Medical)
										</span>
										<p class="mt-1 text-2xs text-muted-foreground">
											ต้องการพยาบาลและผู้ดูแลผู้ป่วยไข้
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<FileText class="h-3.5 w-3.5 text-primary" />
											คัดกรองประวัติ (Screening)
										</span>
										<p class="mt-1 text-2xs text-muted-foreground">
											บันทึกข้อมูลหน้าจุดลงทะเบียนร่วมกับระบบคลาวด์
										</p>
									</div>
								</label>

								<label
									class="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 select-none hover:bg-muted/10"
								>
									<input
										type="checkbox"
										class="mt-1 h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary"
									/>
									<div>
										<span class="flex items-center gap-1.5 text-xs font-bold text-foreground">
											<Truck class="h-3.5 w-3.5 text-warning-foreground" />
											ขนย้ายสิ่งของ (Lifting/Logistics)
										</span>
										<p class="mt-1 text-2xs text-muted-foreground">
											ใช้แรงจัดขนของ ยานพาหนะ อุปกรณ์ช่วยเหลือภัยน้ำท่วม
										</p>
									</div>
								</label>
							</div>
						</div>

						<button
							type="submit"
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
						>
							+ ยื่นส่งแบบฟอร์มอาสาสมัคร
						</button>
					</form>
				</div>
			</div>

			<!-- Sidebar -->
			<div class="flex flex-col gap-5">
				<!-- Welfare list -->
				<div class="rounded-3xl border border-border bg-card p-5 shadow-sm">
					<h3 class="flex items-center gap-1.5 text-sm font-bold text-foreground">
						<Heart class="h-4.5 w-4.5 text-danger" />
						คุณจะได้รับสวัสดิการอะไรบ้าง?
					</h3>
					<p class="mt-2 text-2xs leading-relaxed text-muted-foreground">
						โครงการยึดถือมาตรฐานสากลในการดูแลช่วยเหลือและสนับสนุนปัจจัยสี่ให้กับอาสาสมัครส่วนหน้าระหว่างปฏิบัติงาน:
					</p>

					<div class="mt-4 space-y-3.5">
						<div class="flex gap-2.5">
							<span class="text-sm">🍱</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">โภชนาการประจำมื้อ</h4>
								<p class="text-3xs text-muted-foreground">
									รับสิทธิ์อาหารหลักกล่องฟรีตามที่จองลงกะงาน
								</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">💧</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">น้ำดื่มผลิตสะอาด</h4>
								<p class="text-3xs text-muted-foreground">
									ได้รับการจัดสรรน้ำขวดพกพาปฏิบัติงานอย่างต่อเนื่อง
								</p>
							</div>
						</div>
						<div class="flex gap-2.5">
							<span class="text-sm">🦺</span>
							<div>
								<h4 class="text-xs font-bold text-foreground">ชุดเครื่องแต่งกาย & อุปกรณ์ PPE</h4>
								<p class="text-3xs text-muted-foreground">
									เสื้อสะท้อนแสง หน้ากาก ถุงมือ ปฐมพยาบาลครบครัน
								</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Safety Info -->
				<div class="rounded-3xl border border-warning-border/40 bg-warning/5 p-5">
					<h4 class="flex items-center gap-1.5 text-xs font-bold text-warning-foreground">
						<Info class="h-4 w-4 text-warning-foreground" />
						ข้อทดสอบความปลอดภัย
					</h4>
					<p class="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
						อาสาสมัครทุกคนจะต้องปฏิบัติตามแผนคำสั่งและคำแนะนำของหัวหน้าเวรศูนย์พักพิงหลัก
						หากพบอาการไม่สบาย มีไข้ หรือเกิดอุบัติเหตุแจ้งทีมแพทย์ส่วนหลังทันที!
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- TAB 2: พอร์ทัล & บัตรงานอาสา -->
	{#if activeTab === 'portal'}
		<div class="mx-auto max-w-2xl space-y-6">
			<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
							<UserCheck class="h-5 w-5 text-primary" />
							พอร์ทัลอาสาสมัคร (My Portal)
						</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							เข้าสู่ระบบด้วยเบอร์โทรศัพท์ที่ลงทะเบียนไว้ หรือกรอกรหัสตั๋วจิตอาสา
						</p>
					</div>
					{#if portalPhone}
						<button
							onclick={portalSignOut}
							class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-2xs font-bold text-muted-foreground transition-colors hover:text-foreground"
						>
							ออกจากระบบ
						</button>
					{/if}
				</div>

				{#if !portalPhone}
					<form onsubmit={portalSignIn} class="mt-6 flex gap-3">
						<div class="relative flex-1">
							<input
								type="text"
								bind:value={portalInput}
								placeholder="เบอร์โทรศัพท์ หรือรหัสตั๋ว TKT-VOL-…"
								aria-label="เบอร์โทรศัพท์ หรือรหัสตั๋วจิตอาสา"
								class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 pl-10 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
							/>
							<Search class="absolute top-3.5 left-3.5 h-4 w-4 text-muted-foreground" />
						</div>
						<button
							type="submit"
							class="rounded-xl bg-primary px-5 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
						>
							เข้าสู่ระบบ
						</button>
					</form>

					{#if portalError}
						<p class="mt-3 text-xs text-destructive" role="alert">{portalError}</p>
					{/if}

					<!-- Placeholder until someone signs in — the same empty state as before. -->
					<div
						class="mt-8 rounded-2xl border border-dashed border-border bg-muted/10 p-10 text-center"
					>
						<div
							class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground/80"
						>
							<QrCode class="h-6 w-6" />
						</div>
						<h4 class="text-sm font-bold text-foreground">
							เข้าสู่ระบบเพื่อดูตารางงานและบัตรประจำตัว
						</h4>
						<p class="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
							ใช้เบอร์โทรศัพท์ที่ใช้ตอนสมัคร เพื่อดูกะงานที่ได้รับมอบหมาย
							หรือกรอกรหัสตั๋วเพื่อเปิดบัตร QR สำหรับรายงานตัวหน้างาน
						</p>
					</div>
				{:else}
					<p class="mt-4 text-xs text-muted-foreground">
						เข้าสู่ระบบด้วยเบอร์ <span class="font-bold text-foreground">{portalPhone}</span>
					</p>
				{/if}
			</div>

			{#if portalPhone}
				<!-- ตารางทำงานจิตอาสา — shift_assignment, what the volunteer is rostered on. -->
				<section class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
					<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
						<ClipboardList class="h-5 w-5 text-primary" />
						ตารางทำงานจิตอาสา
					</h3>
					<p class="mt-1 mb-5 text-xs text-muted-foreground">
						กะงานที่ศูนย์พักพิงมอบหมายให้คุณ พร้อมสถานะการรายงานตัว
					</p>
					<VolunteerSchedule phone={portalPhone} />
				</section>

				<!-- บัตรอาสาสมัคร — the applications this number filed, each opening its pass. -->
				<section class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
					<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
						<QrCode class="h-5 w-5 text-primary" />
						บัตรอาสาสมัครของฉัน
					</h3>
					<p class="mt-1 mb-5 text-xs text-muted-foreground">
						เปิดบัตรเพื่อแสดง QR Code ให้เจ้าหน้าที่สแกนตอนรายงานตัว
					</p>

					{#if portalTickets.isPending}
						<p class="text-xs text-muted-foreground">กำลังโหลด…</p>
					{:else if portalTickets.isError}
						<p class="text-xs text-destructive" role="alert">
							{portalTickets.error instanceof Error
								? portalTickets.error.message
								: 'ไม่สามารถโหลดบัตรได้'}
						</p>
					{:else if (portalTickets.data ?? []).length === 0}
						<p class="text-xs text-muted-foreground">
							ยังไม่มีบัตรสำหรับเบอร์นี้ — บัตรจะออกให้เมื่อสมัครงานอาสาสำเร็จ
						</p>
					{:else}
						<ul class="flex flex-col gap-3">
							{#each portalTickets.data ?? [] as ticket (ticket.view_token)}
								<li
									class="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/5 p-4"
								>
									<div class="min-w-0">
										<p class="truncate text-sm font-bold text-foreground">
											{ticket.job_title || 'งานอาสาสมัคร'}
										</p>
										<p class="mt-0.5 text-xs text-muted-foreground">
											{ticket.shelter_code}{ticket.shift_date ? ` · ${ticket.shift_date}` : ''} ·
											{ticketStatusLabel(ticket.status)}
										</p>
									</div>
									<a
										href={resolve(`/volunteer/ticket/${ticket.view_token}`)}
										class="shrink-0 rounded-xl border border-border px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted"
									>
										เปิดบัตร
									</a>
								</li>
							{/each}
						</ul>
						<!--
							Signed in by phone, so these open read-only. Cancelling stays behind the
							ticket link the volunteer was given when they applied — a phone number is
							guessable, and a withdrawn shift cannot be taken back.
						-->
						<p class="mt-4 text-2xs text-muted-foreground">
							เปิดจากการเข้าสู่ระบบด้วยเบอร์โทร — ดูได้อย่างเดียว หากต้องการยกเลิกการสมัคร
							ให้ใช้ลิงก์ตั๋วที่ได้รับตอนสมัคร
						</p>
					{/if}
				</section>
			{/if}
		</div>
	{/if}

	<!-- TAB 3: ประกาศความต้องการกำลังพล -->
	{#if activeTab === 'needs'}
		<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
			<div
				class="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center"
			>
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<ClipboardList class="h-5 w-5 text-primary" />
						ประกาศความต้องการกำลังพล
					</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						ประกาศรับสมัครจิตอาสาตามความต้องการของแต่ละศูนย์พักพิง
					</p>
				</div>
				<!-- Search -->
				<div class="relative w-full md:w-80">
					<input
						type="text"
						placeholder="ค้นหาชื่อศูนย์ หรือ อปท."
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					/>
					<Search class="absolute top-3 left-3 h-3.5 w-3.5 text-muted-foreground" />
				</div>
			</div>

			<!-- List -->
			<div class="flex flex-col gap-6">
				<!-- Shelter Row 1 -->
				<div class="rounded-2xl border border-border bg-muted/5 p-5">
					<div
						class="mb-4 flex flex-col justify-between gap-4 border-b border-border/50 pb-4 sm:flex-row sm:items-start"
					>
						<div>
							<h3 class="text-sm font-bold text-foreground">
								ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)
							</h3>
							<p class="mt-0.5 text-2xs text-muted-foreground">
								อปท. เทศบาลนครหาดใหญ่ | จำนวนผู้พักพิง 1/250 คน
							</p>
						</div>
						<span
							class="shrink-0 rounded-lg bg-danger-muted/30 px-3 py-1.5 text-xs font-bold text-danger"
						>
							ต้องการอาสาเพิ่ม 6 อัตรา
						</span>
					</div>

					<div class="mb-3 text-xs font-bold text-foreground">ความต้องการทักษะเฉพาะด้าน:</div>
					<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• แม่ครัว/ทำอาหาร</span>
							<span class="font-bold text-foreground">ต้องการ: 2 คน</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• ทีมแพทย์/พยาบาล</span>
							<span class="font-bold text-foreground">ต้องการ: 0 คน</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• ทีมคัดกรองประวัติ</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
					</div>

					<button
						onclick={() => (activeTab = 'register')}
						class="flex w-full cursor-pointer items-center justify-center rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/95"
					>
						สมัครเป็นอาสาสมัครประจำศูนย์นี้
					</button>
				</div>

				<!-- Shelter Row 2 -->
				<div class="rounded-2xl border border-border bg-muted/5 p-5">
					<div
						class="mb-4 flex flex-col justify-between gap-4 border-b border-border/50 pb-4 sm:flex-row sm:items-start"
					>
						<div>
							<h3 class="text-sm font-bold text-foreground">
								ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)
							</h3>
							<p class="mt-0.5 text-2xs text-muted-foreground">
								อปท. เทศบาลเมืองคลองแห | จำนวนผู้พักพิง 1/180 คน
							</p>
						</div>
						<span
							class="shrink-0 rounded-lg bg-danger-muted/30 px-3 py-1.5 text-xs font-bold text-danger"
						>
							ต้องการอาสาเพิ่ม 6 อัตรา
						</span>
					</div>

					<div class="mb-3 text-xs font-bold text-foreground">ความต้องการทักษะเฉพาะด้าน:</div>
					<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• แม่ครัว/ทำอาหาร</span>
							<span class="font-bold text-foreground">ต้องการ: 4 คน</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• ทีมแพทย์/พยาบาล</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
						<div
							class="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs"
						>
							<span class="text-muted-foreground">• ทีมคัดกรองประวัติ</span>
							<span class="font-bold text-foreground">ต้องการ: 1 คน</span>
						</div>
					</div>

					<button
						onclick={() => (activeTab = 'register')}
						class="flex w-full cursor-pointer items-center justify-center rounded-xl bg-primary py-3 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/95"
					>
						สมัครเป็นอาสาสมัครประจำศูนย์นี้
					</button>
				</div>
			</div>
		</div>
	{/if}
</PublicPageShell>

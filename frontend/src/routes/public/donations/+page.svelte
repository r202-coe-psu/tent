<script lang="ts">
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import FileText from '@lucide/svelte/icons/file-text';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Phone from '@lucide/svelte/icons/phone';
	import Check from '@lucide/svelte/icons/check';
	import User from '@lucide/svelte/icons/user';
	import Box from '@lucide/svelte/icons/box';
	import Plus from '@lucide/svelte/icons/plus';

	let activeTab = $state('needs');
	let reachedStep = $state(1); // 1: needs, 2: form, 3: time, 4: ticket

	// State for donor form
	let donorName = $state('');
	let donorPhone = $state('');
	let donorLine = $state('');
	let donorEmail = $state('');
	let taxReceipt = $state(false);

	// State for donation items
	let items = $state<{ name: string; amount: number; unit: string }[]>([]);

	function addItem() {
		items.push({ name: '', amount: 1, unit: 'ชิ้น' });
	}

	function removeItem(index: number) {
		items = items.filter((_, i) => i !== index);
	}
</script>

<svelte:head>
	<title>บริจาคและจองคิว — Smart Shelter</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<!-- Tab Bar Navigation -->
	<div class="mb-8 flex justify-center">
		<div class="inline-flex rounded-xl border border-border/50 bg-muted/60 p-1 shadow-2xs">
			<button
				onclick={() => {
					if (reachedStep >= 1) activeTab = 'needs';
				}}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab ===
				'needs'
					? 'bg-card text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Compass class="h-3.5 w-3.5" />
				ความต้องการด่วน
			</button>
			<button
				onclick={() => {
					if (reachedStep >= 2) activeTab = 'form';
				}}
				disabled={reachedStep < 2}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab ===
				'form'
					? 'bg-card text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'} {reachedStep < 2
					? 'cursor-not-allowed opacity-40'
					: ''}"
			>
				<Heart class="h-3.5 w-3.5" />
				ฟอร์มบริจาค
			</button>
			<button
				onclick={() => {
					if (reachedStep >= 3) activeTab = 'time';
				}}
				disabled={reachedStep < 3}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab ===
				'time'
					? 'bg-card text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'} {reachedStep < 3
					? 'cursor-not-allowed opacity-40'
					: ''}"
			>
				<MapPin class="h-3.5 w-3.5" />
				เวลา/สถานที่
			</button>
			<button
				onclick={() => {
					if (reachedStep >= 4) activeTab = 'ticket';
				}}
				disabled={reachedStep < 4}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab ===
				'ticket'
					? 'bg-card text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'} {reachedStep < 4
					? 'cursor-not-allowed opacity-40'
					: ''}"
			>
				<FileText class="h-3.5 w-3.5" />
				ตั๋วของฉัน
			</button>
		</div>
	</div>

	<!-- TAB 1: ความต้องการด่วน -->
	{#if activeTab === 'needs'}
		<div class="rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
			<div
				class="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center"
			>
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<Heart class="h-5 w-5 text-primary" />
						กระดานความต้องการด่วน
					</h2>
					<p class="mt-1 text-[11px] text-muted-foreground">
						อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง
						คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
					</p>
				</div>
				<!-- Search -->
				<div class="relative w-full md:w-80">
					<input
						type="text"
						placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
						class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					/>
					<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
				</div>
			</div>

			<!-- Categories -->
			<div class="mb-6 flex flex-wrap gap-2">
				<button class="rounded-full bg-foreground px-4 py-1.5 text-xs font-bold text-background"
					>ทั้งหมด</button
				>
				<button
					class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
					>ด่วนพิเศษ</button
				>
				<button
					class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
					>อาหาร & น้ำ</button
				>
				<button
					class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
					>ยารักษาโรค</button
				>
			</div>

			<!-- Shelter list -->
			<div class="flex flex-col gap-6">
				<!-- Shelter Card 1 -->
				<div
					class="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-muted/5 p-5 md:flex-row md:items-center"
				>
					<div class="flex-1">
						<div class="flex items-center gap-2.5">
							<span class="rounded-lg border border-blue-100 bg-blue-50 p-1 text-blue-600">
								<Compass class="h-4 w-4" />
							</span>
							<div>
								<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลนครหาดใหญ่</h3>
								<p class="text-[10px] text-muted-foreground">(โรงเรียนเทศบาล 2)</p>
							</div>
							<span
								class="ml-2 rounded-full bg-primary-muted px-2.5 py-0.5 text-[10px] font-bold text-primary"
								>เปิดรับบริจาค</span
							>
						</div>

						<!-- Needs list inside shelter -->
						<div class="mt-4 flex flex-col gap-2">
							<!-- Need Item 1 -->
							<div
								class="flex items-center justify-between rounded-lg border border-danger-border/30 bg-danger-muted/20 px-3.5 py-2 text-xs"
							>
								<span class="font-bold text-danger">• ด่วน! น้ำดื่ม</span>
								<span
									class="rounded-md border border-danger/10 bg-white px-2 py-0.5 text-[10px] font-bold text-danger"
									>ขาด 500 แพ็ค</span
								>
							</div>
							<!-- Need Item 2 -->
							<div
								class="flex items-center justify-between rounded-lg border border-danger-border/30 bg-danger-muted/20 px-3.5 py-2 text-xs"
							>
								<span class="font-bold text-danger">• ด่วน! ยาแก้ปวด</span>
								<span
									class="rounded-md border border-danger/10 bg-white px-2 py-0.5 text-[10px] font-bold text-danger"
									>ขาด 200 แผง</span
								>
							</div>
							<!-- Need Item 3 -->
							<div
								class="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground"
							>
								<span>ขอรับบริจาคเสื้อผ้ามือสอง</span>
								<span class="text-[10px]">ค้นสต๊อก 12...</span>
							</div>
						</div>
					</div>

					<!-- Right Column: Donation button -->
					<div
						class="flex shrink-0 flex-col items-center justify-center pt-4 md:border-l md:border-border/60 md:pt-0 md:pl-6"
					>
						<button
							onclick={() => {
								activeTab = 'form';
								if (reachedStep < 2) reachedStep = 2;
							}}
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 md:w-auto"
						>
							จองคิวบริจาค
							<span>→</span>
						</button>
						<span class="mt-2 text-center text-[10px] text-muted-foreground"
							>ช่วยลดความแออัดหน้าศูนย์</span
						>
					</div>
				</div>

				<!-- Shelter Card 2 -->
				<div
					class="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-muted/5 p-5 md:flex-row md:items-center"
				>
					<div class="flex-1">
						<div class="flex items-center gap-2.5">
							<span class="rounded-lg border border-blue-100 bg-blue-50 p-1 text-blue-600">
								<Compass class="h-4 w-4" />
							</span>
							<div>
								<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลเมืองคลองแห</h3>
								<p class="text-[10px] text-muted-foreground">(โรงเรียนวัดคลองแห)</p>
							</div>
							<span
								class="ml-2 rounded-full bg-primary-muted px-2.5 py-0.5 text-[10px] font-bold text-primary"
								>เปิดรับบริจาค</span
							>
						</div>
					</div>
					<div
						class="flex shrink-0 flex-col items-center justify-center pt-4 md:border-l md:border-border/60 md:pt-0 md:pl-6"
					>
						<button
							onclick={() => {
								activeTab = 'form';
								if (reachedStep < 2) reachedStep = 2;
							}}
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 md:w-auto"
						>
							จองคิวบริจาค
							<span>→</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- TAB 2: ฟอร์มบริจาค -->
	{#if activeTab === 'form'}
		<div class="rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
			<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
			<div class="mb-8">
				<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
					<div
						class="flex h-7 w-7 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-blue-600"
					>
						<User class="h-4 w-4" />
					</div>
					<div>
						<h2 class="text-[15px] font-bold text-foreground">ส่วนที่ 1: ข้อมูลผู้บริจาค</h2>
						<p class="text-[10px] text-muted-foreground">สำหรับติดต่อกลับกรณีฉุกเฉิน</p>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div>
						<label class="block text-xs font-bold text-foreground" for="donor-name">
							ชื่อ-นามสกุล / นามแฝง / องค์กร <span class="text-danger">*</span>
						</label>
						<input
							type="text"
							id="donor-name"
							bind:value={donorName}
							placeholder="เช่น บจก. ใจดี หรือ นางสาว รักดี"
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>

					<div>
						<label class="block text-xs font-bold text-foreground" for="donor-phone">
							เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span>
						</label>
						<input
							type="text"
							id="donor-phone"
							bind:value={donorPhone}
							placeholder="สำหรับส่ง SMS ยืนยัน"
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>

					<div>
						<label class="block text-xs font-bold text-foreground" for="donor-line">
							Line ID (ไม่บังคับ)
						</label>
						<input
							type="text"
							id="donor-line"
							bind:value={donorLine}
							placeholder=""
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>

					<div>
						<label class="block text-xs font-bold text-foreground" for="donor-email">
							อีเมล (ไม่บังคับ)
						</label>
						<input
							type="email"
							id="donor-email"
							bind:value={donorEmail}
							placeholder=""
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>
				</div>

				<!-- Tax exemption checkbox block -->
				<label
					class="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-border/40 bg-muted/30 p-4 select-none"
				>
					<input
						type="checkbox"
						bind:checked={taxReceipt}
						class="h-4.5 w-4.5 rounded border-border text-primary focus:ring-primary"
					/>
					<span class="text-xs font-bold text-foreground">ต้องการใบอนุโมทนาบัตร / ลดหย่อนภาษี</span>
				</label>
			</div>

			<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
			<div class="mb-8">
				<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
					<div
						class="flex h-7 w-7 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-amber-600"
					>
						<Box class="h-4 w-4" />
					</div>
					<div>
						<h2 class="text-[15px] font-bold text-foreground">
							ส่วนที่ 2: รายละเอียดสิ่งของบริจาค
						</h2>
						<p class="text-[10px] text-muted-foreground">ระบุรายการสิ่งของที่คุณจะนำมามอบให้</p>
					</div>
				</div>

				<!-- Items Table / List -->
				{#if items.length > 0}
					<div class="mb-4 flex flex-col gap-3">
						{#each items as item, index}
							<div
								class="flex items-center gap-2.5 rounded-xl border border-border bg-muted/10 p-3"
							>
								<input
									type="text"
									placeholder="เช่น ข้าวสาร, แพมเพิสเด็ก"
									bind:value={item.name}
									class="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
								<input
									type="number"
									placeholder="จำนวน"
									bind:value={item.amount}
									class="w-20 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
								<input
									type="text"
									placeholder="หน่วย เช่น แพ็ค, ชิ้น"
									bind:value={item.unit}
									class="w-24 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
								<button
									onclick={() => removeItem(index)}
									class="px-2 text-xs font-bold text-danger hover:underline"
								>
									ลบ
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Add item button -->
				<button
					onclick={addItem}
					class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-xs font-bold text-primary transition-colors hover:bg-muted/30"
				>
					<Plus class="h-4 w-4" />
					เพิ่มรายการสิ่งของ
				</button>
			</div>

			<!-- Form Submit / Next Button -->
			<button
				onclick={() => {
					if (donorName && donorPhone) {
						activeTab = 'time';
						if (reachedStep < 3) reachedStep = 3;
					}
				}}
				disabled={!donorName || !donorPhone}
				class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-bold text-white transition-colors {donorName &&
				donorPhone
					? 'bg-primary hover:bg-primary-dark'
					: 'cursor-not-allowed bg-muted-foreground/30 text-muted-foreground'}"
			>
				ถัดไป: เลือกจุดส่งมอบ
				<span>→</span>
			</button>
		</div>
	{/if}

	<!-- TAB 3: เวลา/สถานที่ -->
	{#if activeTab === 'time'}
		<div class="rounded-3xl border border-border bg-card p-6 text-center shadow-xs md:p-8">
			<MapPin class="mx-auto mb-4 h-12 w-12 text-primary/80" />
			<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ
			</p>

			<div class="mt-6 inline-flex w-full max-w-sm flex-col gap-3 text-left">
				<label class="block text-xs font-bold text-foreground"> จุดส่งมอบปลายทาง </label>
				<select
					class="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
				>
					<option>ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
					<option>ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
				</select>

				<label class="mt-2 block text-xs font-bold text-foreground">
					วันที่และเวลาที่จะส่งของ
				</label>
				<input
					type="datetime-local"
					class="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary"
				/>

				<button
					onclick={() => {
						activeTab = 'ticket';
						if (reachedStep < 4) reachedStep = 4;
					}}
					class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-bold text-white transition-colors hover:bg-primary-dark"
				>
					ยืนยันการจองคิวบริจาค
					<span>→</span>
				</button>
			</div>
		</div>
	{/if}

	<!-- TAB 4: ตั๋วของฉัน -->
	{#if activeTab === 'ticket'}
		<div
			class="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-xs md:p-8"
		>
			<div
				class="bg-success-muted text-success border-success/25 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border"
			>
				<Check class="h-8 w-8" />
			</div>

			<h2 class="text-lg font-bold text-foreground">จองสิทธิ์บริจาคสําเร็จ!</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				กรุณาแคปหน้าจอเพื่อเก็บตั๋วและรหัสการจองไว้ใช้ยืนยัน ณ จุดส่งมอบ
			</p>

			<div class="my-6 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5">
				<!-- Mock QR & Token info -->
				<div
					class="mx-auto mb-4 flex h-32 w-32 items-center justify-center rounded-xl border border-border/80 bg-white p-3"
				>
					<span class="text-xs text-slate-400">QR Code</span>
				</div>

				<div class="text-xs font-bold text-foreground">Tracking Token</div>
				<div class="mt-1 font-mono text-sm font-black tracking-wider text-primary select-all">
					TX-DON-792B
				</div>

				<div
					class="mt-4 space-y-2 border-t border-border/60 pt-4 text-left text-[11px] text-muted-foreground"
				>
					<div class="flex justify-between">
						<span>ผู้บริจาค:</span>
						<span class="font-bold text-foreground">นางสาว ใจดี</span>
					</div>
					<div class="flex justify-between">
						<span>จุดส่งมอบ:</span>
						<span class="font-bold text-foreground">โรงเรียนเทศบาล 2</span>
					</div>
					<div class="flex justify-between">
						<span>เวลาส่งมอบ:</span>
						<span class="font-bold text-foreground">18 มิ.ย. 2026 - 15:00 น.</span>
					</div>
				</div>
			</div>

			<button
				onclick={() => {
					activeTab = 'needs';
					items = [];
					donorName = '';
					donorPhone = '';
					reachedStep = 1;
				}}
				class="w-full rounded-xl border border-border py-3 text-xs font-bold text-foreground transition-colors hover:bg-muted"
			>
				กลับหน้าแรกกระดานความต้องการ
			</button>
		</div>
	{/if}
</div>

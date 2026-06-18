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
		<div class="inline-flex rounded-xl bg-muted/60 p-1 border border-border/50 shadow-2xs">
			<button 
				onclick={() => { if (reachedStep >= 1) activeTab = 'needs'; }}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab === 'needs' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
			>
				<Compass class="h-3.5 w-3.5" />
				ความต้องการด่วน
			</button>
			<button 
				onclick={() => { if (reachedStep >= 2) activeTab = 'form'; }}
				disabled={reachedStep < 2}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab === 'form' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {reachedStep < 2 ? 'opacity-40 cursor-not-allowed' : ''}"
			>
				<Heart class="h-3.5 w-3.5" />
				ฟอร์มบริจาค
			</button>
			<button 
				onclick={() => { if (reachedStep >= 3) activeTab = 'time'; }}
				disabled={reachedStep < 3}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab === 'time' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {reachedStep < 3 ? 'opacity-40 cursor-not-allowed' : ''}"
			>
				<MapPin class="h-3.5 w-3.5" />
				เวลา/สถานที่
			</button>
			<button 
				onclick={() => { if (reachedStep >= 4) activeTab = 'ticket'; }}
				disabled={reachedStep < 4}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {activeTab === 'ticket' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {reachedStep < 4 ? 'opacity-40 cursor-not-allowed' : ''}"
			>
				<FileText class="h-3.5 w-3.5" />
				ตั๋วของฉัน
			</button>
		</div>
	</div>

	<!-- TAB 1: ความต้องการด่วน -->
	{#if activeTab === 'needs'}
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
			<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-6 mb-6">
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<Heart class="h-5 w-5 text-primary" />
						กระดานความต้องการด่วน
					</h2>
					<p class="mt-1 text-[11px] text-muted-foreground">
						อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
					</p>
				</div>
				<!-- Search -->
				<div class="relative w-full md:w-80">
					<input 
						type="text" 
						placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
						class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
					/>
					<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
				</div>
			</div>

			<!-- Categories -->
			<div class="flex flex-wrap gap-2 mb-6">
				<button class="rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-bold">ทั้งหมด</button>
				<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">ด่วนพิเศษ</button>
				<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">อาหาร & น้ำ</button>
				<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">ยารักษาโรค</button>
			</div>

			<!-- Shelter list -->
			<div class="flex flex-col gap-6">
				<!-- Shelter Card 1 -->
				<div class="rounded-2xl border border-border p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-muted/5">
					<div class="flex-1">
						<div class="flex items-center gap-2.5">
							<span class="rounded-lg bg-blue-50 text-blue-600 border border-blue-100 p-1">
								<Compass class="h-4 w-4" />
							</span>
							<div>
								<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลนครหาดใหญ่</h3>
								<p class="text-[10px] text-muted-foreground">(โรงเรียนเทศบาล 2)</p>
							</div>
							<span class="ml-2 rounded-full bg-primary-muted text-primary px-2.5 py-0.5 text-[10px] font-bold">เปิดรับบริจาค</span>
						</div>

						<!-- Needs list inside shelter -->
						<div class="mt-4 flex flex-col gap-2">
							<!-- Need Item 1 -->
							<div class="flex items-center justify-between rounded-lg bg-danger-muted/20 border border-danger-border/30 px-3.5 py-2 text-xs">
								<span class="font-bold text-danger">• ด่วน! น้ำดื่ม</span>
								<span class="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/10">ขาด 500 แพ็ค</span>
							</div>
							<!-- Need Item 2 -->
							<div class="flex items-center justify-between rounded-lg bg-danger-muted/20 border border-danger-border/30 px-3.5 py-2 text-xs">
								<span class="font-bold text-danger">• ด่วน! ยาแก้ปวด</span>
								<span class="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/10">ขาด 200 แผง</span>
							</div>
							<!-- Need Item 3 -->
							<div class="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
								<span>ขอรับบริจาคเสื้อผ้ามือสอง</span>
								<span class="text-[10px]">ค้นสต๊อก 12...</span>
							</div>
						</div>
					</div>

					<!-- Right Column: Donation button -->
					<div class="flex flex-col items-center justify-center shrink-0 md:border-l md:border-border/60 md:pl-6 pt-4 md:pt-0">
						<button onclick={() => { activeTab = 'form'; if (reachedStep < 2) reachedStep = 2; }} class="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs px-5 py-3 shadow-xs transition-colors cursor-pointer w-full md:w-auto">
							จองคิวบริจาค
							<span>→</span>
						</button>
						<span class="mt-2 text-[10px] text-muted-foreground text-center">ช่วยลดความแออัดหน้าศูนย์</span>
					</div>
				</div>

				<!-- Shelter Card 2 -->
				<div class="rounded-2xl border border-border p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-muted/5">
					<div class="flex-1">
						<div class="flex items-center gap-2.5">
							<span class="rounded-lg bg-blue-50 text-blue-600 border border-blue-100 p-1">
								<Compass class="h-4 w-4" />
							</span>
							<div>
								<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลเมืองคลองแห</h3>
								<p class="text-[10px] text-muted-foreground">(โรงเรียนวัดคลองแห)</p>
							</div>
							<span class="ml-2 rounded-full bg-primary-muted text-primary px-2.5 py-0.5 text-[10px] font-bold">เปิดรับบริจาค</span>
						</div>
					</div>
					<div class="flex flex-col items-center justify-center shrink-0 md:border-l md:border-border/60 md:pl-6 pt-4 md:pt-0">
						<button onclick={() => { activeTab = 'form'; if (reachedStep < 2) reachedStep = 2; }} class="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs px-5 py-3 shadow-xs transition-colors cursor-pointer w-full md:w-auto">
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
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
			<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
			<div class="mb-8">
				<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
					<div class="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
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
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
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
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
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
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
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
							class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
						/>
					</div>
				</div>

				<!-- Tax exemption checkbox block -->
				<label class="mt-4 flex items-center gap-3 cursor-pointer rounded-xl bg-muted/30 border border-border/40 p-4 select-none">
					<input 
						type="checkbox" 
						bind:checked={taxReceipt}
						class="rounded border-border text-primary focus:ring-primary h-4.5 w-4.5" 
					/>
					<span class="text-xs font-bold text-foreground">ต้องการใบอนุโมทนาบัตร / ลดหย่อนภาษี</span>
				</label>
			</div>

			<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
			<div class="mb-8">
				<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
					<div class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-100">
						<Box class="h-4 w-4" />
					</div>
					<div>
						<h2 class="text-[15px] font-bold text-foreground">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h2>
						<p class="text-[10px] text-muted-foreground">ระบุรายการสิ่งของที่คุณจะนำมามอบให้</p>
					</div>
				</div>

				<!-- Items Table / List -->
				{#if items.length > 0}
					<div class="flex flex-col gap-3 mb-4">
						{#each items as item, index}
							<div class="flex items-center gap-2.5 rounded-xl border border-border p-3 bg-muted/10">
								<input 
									type="text" 
									placeholder="เช่น ข้าวสาร, แพมเพิสเด็ก"
									bind:value={item.name}
									class="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary focus:border-primary"
								/>
								<input 
									type="number" 
									placeholder="จำนวน"
									bind:value={item.amount}
									class="w-20 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary focus:border-primary"
								/>
								<input 
									type="text" 
									placeholder="หน่วย เช่น แพ็ค, ชิ้น"
									bind:value={item.unit}
									class="w-24 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary focus:border-primary"
								/>
								<button 
									onclick={() => removeItem(index)}
									class="text-xs text-danger font-bold hover:underline px-2"
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
					class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border hover:bg-muted/30 py-3 text-xs font-bold text-primary transition-colors cursor-pointer"
				>
					<Plus class="h-4 w-4" />
					เพิ่มรายการสิ่งของ
				</button>
			</div>

			<!-- Form Submit / Next Button -->
			<button 
				onclick={() => { if (donorName && donorPhone) { activeTab = 'time'; if (reachedStep < 3) reachedStep = 3; } }}
				disabled={!donorName || !donorPhone}
				class="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-bold text-white transition-colors cursor-pointer {donorName && donorPhone ? 'bg-primary hover:bg-primary-dark' : 'bg-muted-foreground/30 text-muted-foreground cursor-not-allowed'}"
			>
				ถัดไป: เลือกจุดส่งมอบ
				<span>→</span>
			</button>
		</div>
	{/if}

	<!-- TAB 3: เวลา/สถานที่ -->
	{#if activeTab === 'time'}
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center">
			<MapPin class="mx-auto h-12 w-12 text-primary/80 mb-4" />
			<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
			<p class="mt-1 text-xs text-muted-foreground">กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ</p>

			<div class="mt-6 inline-flex flex-col gap-3 text-left w-full max-w-sm">
				<label class="block text-xs font-bold text-foreground">
					จุดส่งมอบปลายทาง
				</label>
				<select class="rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary w-full">
					<option>ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
					<option>ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
				</select>

				<label class="block text-xs font-bold text-foreground mt-2">
					วันที่และเวลาที่จะส่งของ
				</label>
				<input 
					type="datetime-local" 
					class="rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary w-full"
				/>

				<button 
					onclick={() => { activeTab = 'ticket'; if (reachedStep < 4) reachedStep = 4; }} 
					class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-dark py-3.5 text-xs font-bold text-white transition-colors"
				>
					ยืนยันการจองคิวบริจาค
					<span>→</span>
				</button>
			</div>
		</div>
	{/if}

	<!-- TAB 4: ตั๋วของฉัน -->
	{#if activeTab === 'ticket'}
		<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center max-w-md mx-auto">
			<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-muted text-success border border-success/25 mb-4">
				<Check class="h-8 w-8" />
			</div>
			
			<h2 class="text-lg font-bold text-foreground">จองสิทธิ์บริจาคสําเร็จ!</h2>
			<p class="mt-1 text-xs text-muted-foreground">กรุณาแคปหน้าจอเพื่อเก็บตั๋วและรหัสการจองไว้ใช้ยืนยัน ณ จุดส่งมอบ</p>

			<div class="my-6 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5">
				<!-- Mock QR & Token info -->
				<div class="mx-auto bg-white p-3 border border-border/80 w-32 h-32 flex items-center justify-center rounded-xl mb-4">
					<span class="text-xs text-slate-400">QR Code</span>
				</div>

				<div class="text-xs font-bold text-foreground">Tracking Token</div>
				<div class="mt-1 text-sm font-black text-primary font-mono tracking-wider select-all">TX-DON-792B</div>

				<div class="mt-4 border-t border-border/60 pt-4 text-left space-y-2 text-[11px] text-muted-foreground">
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
				onclick={() => { activeTab = 'needs'; items = []; donorName = ''; donorPhone = ''; reachedStep = 1; }}
				class="w-full rounded-xl border border-border hover:bg-muted py-3 text-xs font-bold text-foreground transition-colors"
			>
				กลับหน้าแรกกระดานความต้องการ
			</button>
		</div>
	{/if}
</div>

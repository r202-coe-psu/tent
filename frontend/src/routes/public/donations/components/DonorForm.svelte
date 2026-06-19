<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Box from '@lucide/svelte/icons/box';
	import Plus from '@lucide/svelte/icons/plus';
	import { donationStore } from '../donation.svelte';
</script>

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
					bind:value={donationStore.donorName}
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
					bind:value={donationStore.donorPhone}
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
					bind:value={donationStore.donorLine}
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
					bind:value={donationStore.donorEmail}
					placeholder=""
					class="mt-1.5 w-full rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
				/>
			</div>
		</div>

		<label class="mt-4 flex items-center gap-3 cursor-pointer rounded-xl bg-muted/30 border border-border/40 p-4 select-none">
			<input 
				type="checkbox" 
				bind:checked={donationStore.taxReceipt}
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

		{#if donationStore.items.length > 0}
			<div class="flex flex-col gap-3 mb-4">
				{#each donationStore.items as item, index}
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
							onclick={() => donationStore.removeItem(index)}
							class="text-xs text-danger font-bold hover:underline px-2"
						>
							ลบ
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<button 
			onclick={() => donationStore.addItem()}
			class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border hover:bg-muted/30 py-3 text-xs font-bold text-primary transition-colors cursor-pointer"
		>
			<Plus class="h-4 w-4" />
			เพิ่มรายการสิ่งของ
		</button>
	</div>

	<!-- Form Submit / Next Button -->
	<button 
		onclick={() => { if (donationStore.donorName && donationStore.donorPhone) { donationStore.activeTab = 'time'; if (donationStore.reachedStep < 3) donationStore.reachedStep = 3; } }}
		disabled={!donationStore.donorName || !donationStore.donorPhone}
		class="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-bold text-white transition-colors cursor-pointer {donationStore.donorName && donationStore.donorPhone ? 'bg-primary hover:bg-primary-dark' : 'bg-muted-foreground/30 text-muted-foreground cursor-not-allowed'}"
	>
		ถัดไป: เลือกจุดส่งมอบ
		<span>→</span>
	</button>
</div>

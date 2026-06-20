<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Box from '@lucide/svelte/icons/box';
	import Plus from '@lucide/svelte/icons/plus';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { donationStore } from '../donation.svelte';

	let validationErrors = $state<string[]>([]);

	function handleNext() {
		validationErrors = [];
		
		// 1. Validate donor name
		if (!donationStore.donorName.trim()) {
			validationErrors.push('กรุณาระบุชื่อ-นามสกุล / นามแฝง / องค์กร');
		}

		// 2. Validate donor phone
		const phoneRegex = /^0[0-9]{9}$/;
		if (!donationStore.donorPhone.trim()) {
			validationErrors.push('กรุณาระบุเบอร์โทรศัพท์มือถือ');
		} else if (!phoneRegex.test(donationStore.donorPhone.trim())) {
			validationErrors.push('กรุณาระบุเบอร์โทรศัพท์มือถือให้ถูกต้อง (รูปแบบ 10 หลัก ขึ้นต้นด้วย 0)');
		}

		// 3. Validate items
		if (donationStore.items.length === 0) {
			validationErrors.push('กรุณาเพิ่มรายการสิ่งของบริจาคอย่างน้อย 1 รายาร');
		} else {
			donationStore.items.forEach((item, index) => {
				if (!item.name.trim()) {
					validationErrors.push(`รายการที่ ${index + 1}: กรุณาระบุชื่อสิ่งของ`);
				}
				if (!item.amount || item.amount <= 0) {
					validationErrors.push(`รายการที่ ${index + 1}: จำนวนสิ่งของต้องมีค่ามากกว่า 0`);
				}
				if (!item.unit.trim()) {
					validationErrors.push(`รายการที่ ${index + 1}: กรุณาระบุหน่วยนับ`);
				}
			});
		}

		if (validationErrors.length === 0) {
			donationStore.activeTab = 'time';
			if (donationStore.reachedStep < 3) donationStore.reachedStep = 3;
		}
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
	<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
			<div class="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
				<User class="h-4 w-4" />
			</div>
			<div>
				<h2 class="text-base font-bold text-foreground">ส่วนที่ 1: ข้อมูลผู้บริจาค</h2>
				<p class="text-xs text-muted-foreground">สำหรับติดต่อกลับกรณีฉุกเฉิน</p>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<Label class="block text-xs font-bold text-foreground" for="donor-name">
					ชื่อ-นามสกุล / นามแฝง / องค์กร <span class="text-danger">*</span>
				</Label>
				<Input 
					type="text" 
					id="donor-name"
					bind:value={donationStore.donorName}
					placeholder="เช่น บจก. ใจดี หรือ นางสาว รักดี"
					class="mt-1.5"
				/>
			</div>

			<div>
				<Label class="block text-xs font-bold text-foreground" for="donor-phone">
					เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span>
				</Label>
				<Input 
					type="text" 
					id="donor-phone"
					bind:value={donationStore.donorPhone}
					placeholder="สำหรับส่ง SMS ยืนยัน"
					class="mt-1.5"
				/>
			</div>

			<div>
				<Label class="block text-xs font-bold text-foreground" for="donor-line">
					Line ID (ไม่บังคับ)
				</Label>
				<Input 
					type="text" 
					id="donor-line"
					bind:value={donationStore.donorLine}
					placeholder=""
					class="mt-1.5"
				/>
			</div>

			<div>
				<Label class="block text-xs font-bold text-foreground" for="donor-email">
					อีเมล (ไม่บังคับ)
				</Label>
				<Input 
					type="email" 
					id="donor-email"
					bind:value={donationStore.donorEmail}
					placeholder=""
					class="mt-1.5"
				/>
			</div>
		</div>

		<div class="mt-4 flex items-center gap-3 cursor-pointer rounded-xl bg-muted/30 border border-border/40 p-4 select-none">
			<Checkbox 
				id="tax-receipt" 
				bind:checked={donationStore.taxReceipt}
			/>
			<Label for="tax-receipt" class="text-xs font-bold text-foreground cursor-pointer">ต้องการใบอนุโมทนาบัตร / ลดหย่อนภาษี</Label>
		</div>
	</div>

	<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
			<div class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 border border-amber-100">
				<Box class="h-4 w-4" />
			</div>
			<div>
				<h2 class="text-base font-bold text-foreground">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h2>
				<p class="text-xs text-muted-foreground">ระบุรายการสิ่งของที่คุณจะนำมามอบให้</p>
			</div>
		</div>

		{#if donationStore.items.length > 0}
			<div class="flex flex-col gap-3 mb-4">
				{#each donationStore.items as item, index}
					<div class="flex items-center gap-2.5 rounded-xl border border-border p-3 bg-muted/10">
						<Input 
							type="text" 
							placeholder="เช่น ข้าวสาร, แพมเพิสเด็ก"
							bind:value={item.name}
							class="flex-1"
						/>
						<Input 
							type="number" 
							placeholder="จำนวน"
							bind:value={item.amount}
							class="w-20"
						/>
						<Input 
							type="text" 
							placeholder="หน่วย เช่น แพ็ค, ชิ้น"
							bind:value={item.unit}
							class="w-24"
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

	<!-- ส่วนแสดงผลความผิดพลาดจากการตรวจสอบข้อมูล -->
	{#if validationErrors.length > 0}
		<div class="mb-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger">
			<div class="mb-2 flex items-center gap-2 font-bold">
				<AlertCircle class="h-4 w-4" />
				พบข้อมูลไม่ถูกต้อง:
			</div>
			<ul class="list-disc pl-5 space-y-1">
				{#each validationErrors as err}
					<li>{err}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Form Submit / Next Button -->
	<button 
		onclick={handleNext}
		class="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-bold text-white transition-colors cursor-pointer bg-primary hover:bg-primary-dark"
	>
		ถัดไป: เลือกจุดส่งมอบ
		<span>→</span>
	</button>
</div>


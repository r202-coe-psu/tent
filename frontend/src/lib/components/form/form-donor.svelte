<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Package from '@lucide/svelte/icons/package';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { toast } from 'svelte-sonner';
	import { getDonationStore } from '../../../routes/public/donations/donation.svelte';
	import { PUBLIC_DONATION_CATEGORIES } from '$lib/features/donations';

	const donationStore = getDonationStore();
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
			validationErrors.push(
				'กรุณาระบุเบอร์โทรศัพท์มือถือให้ถูกต้อง (รูปแบบ 10 หลัก ขึ้นต้นด้วย 0)'
			);
		}

		// 3. Validate items
		if (donationStore.items.length === 0) {
			validationErrors.push('กรุณาเพิ่มรายการสิ่งของบริจาคอย่างน้อย 1 รายการ');
		} else {
			donationStore.items.forEach((item, index) => {
				if (!item.name || !item.name.trim()) {
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
		} else {
			toast.error('กรุณากรอกข้อมูลให้ถูกต้องครบถ้วน');
		}
	}
</script>

<div class="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-left">
	<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
	<div class="mb-8">
		<div class="flex items-center gap-3 border-b border-slate-100 pb-4 mb-6">
			<div class="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-primary">
				<ShieldCheck class="h-5 w-5" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 1: ข้อมูลผู้บริจาค</h3>
				<p class="text-xs font-medium text-slate-400">สำหรับติดต่อกลับกรณีฉุกเฉิน</p>
			</div>
		</div>

		<div class="space-y-4">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label class="text-xs font-bold text-slate-700 block mb-1.5" for="donor-name">
						ชื่อ-นามสกุล / นามแฝง / องค์กร <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="donor-name"
						bind:value={donationStore.donorName}
						placeholder="เช่น บจก. ใจดี หรือ นางสาว รักดี"
						class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white text-slate-800 outline-hidden transition-all"
					/>
				</div>
				<div>
					<label class="text-xs font-bold text-slate-700 block mb-1.5" for="donor-phone">
						เบอร์โทรศัพท์มือถือ <span class="text-red-500">*</span>
					</label>
					<input
						type="tel"
						id="donor-phone"
						bind:value={donationStore.donorPhone}
						placeholder="สำหรับส่ง SMS ยืนยัน"
						class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-bold text-slate-800 outline-hidden transition-all"
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label class="text-xs font-bold text-slate-700 block mb-1.5" for="donor-line">
						Line ID (ไม่บังคับ)
					</label>
					<input
						type="text"
						id="donor-line"
						bind:value={donationStore.donorLine}
						placeholder="ระบุไอดีไลน์ (ถ้ามี)"
						class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white text-slate-800 outline-hidden transition-all"
					/>
				</div>
				<div>
					<label class="text-xs font-bold text-slate-700 block mb-1.5" for="donor-email">
						อีเมล (ไม่บังคับ)
					</label>
					<input
						type="email"
						id="donor-email"
						bind:value={donationStore.donorEmail}
						placeholder="ระบุที่อยู่อีเมล (ถ้ามี)"
						class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white text-slate-800 outline-hidden transition-all"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
	<div class="mb-8">
		<div class="flex items-center gap-3 border-b border-slate-100 pb-4 mb-6">
			<div class="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
				<Package class="h-5 w-5" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h3>
				<p class="text-xs font-medium text-[#013365] mt-1 bg-[#013365]/10 px-3 py-1 rounded inline-block">
					💡 เลือกลบรายการที่ไม่ต้องการบริจาคออก และปรับระบุจำนวนที่คุณต้องการบริจาคได้ตามสะดวก
				</p>
			</div>
		</div>

		{#if donationStore.items.length > 0}
			<div class="space-y-4 mb-6">
				{#each donationStore.items as item, idx (item.id)}
					<div class="flex flex-col gap-3 bg-slate-50 p-5 rounded-xl border border-slate-200 relative">
						<button
							type="button"
							onclick={() => donationStore.removeItem(item.id)}
							class="absolute top-2 right-2 p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
							title="ลบรายการ"
						>
							<Trash2 class="h-5.5 w-5.5" />
						</button>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
							<div>
								<label class="text-xs font-bold text-slate-600 block mb-1">
									หมวดหมู่
								</label>
								<select
									bind:value={item.category}
									class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-medium text-slate-800 outline-hidden appearance-none"
								>
									<option value="" disabled selected>เลือกหมวดหมู่</option>
									{#each PUBLIC_DONATION_CATEGORIES as cat (cat.value)}
										<option value={cat.value}>{cat.label}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="text-xs font-bold text-slate-600 block mb-1">
									ชื่อสิ่งของ
								</label>
								<input
									type="text"
									placeholder="เช่น น้ำดื่มขวด 600ml"
									bind:value={item.name}
									class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white text-slate-800 outline-hidden"
								/>
							</div>
						</div>

						<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
							<div class="col-span-1">
								<label class="text-xs font-bold text-slate-600 block mb-1">
									ปริมาณ
								</label>
								<input
									type="number"
									min="1"
									bind:value={item.amount}
									class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-bold text-slate-800 outline-hidden"
								/>
							</div>
							<div class="col-span-1">
								<label class="text-xs font-bold text-slate-600 block mb-1">
									หน่วย
								</label>
								<input
									type="text"
									placeholder="เช่น แพ็ค, ลัง, ชิ้น"
									bind:value={item.unit}
									class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-medium text-slate-800 outline-hidden"
								/>
							</div>
							<div class="col-span-2 md:col-span-1">
								<label class="text-xs font-bold text-slate-600 block mb-1">
									สภาพสิ่งของ
								</label>
								<select
									bind:value={item.condition}
									class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-medium text-slate-800 outline-hidden appearance-none"
								>
									<option value="">เลือกสภาพสิ่งของ</option>
									<option value="new">ของใหม่ 100%</option>
									<option value="used">ของมือสอง สภาพดี</option>
								</select>
							</div>
						</div>

						<div>
							<label class="text-xs font-bold text-slate-600 block mb-1">
								หมายเหตุเพิ่มเติม (Optional)
							</label>
							<input
								type="text"
								placeholder="เช่น ข้าวกล่องมังสวิรัติ, เสื้อผ้าเด็ก 5 ขวบ"
								bind:value={item.remark}
								class="w-full border-2 border-slate-200 focus:border-primary rounded-xl p-3 bg-white font-medium text-slate-800 outline-hidden"
							/>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => donationStore.addItem()}
			class="flex items-center justify-center gap-2 text-primary font-bold py-4 hover:bg-muted/10 rounded-xl w-full border-2 border-dashed border-primary/30 transition-colors bg-blue-50/50 cursor-pointer"
		>
			<PlusCircle class="h-5 w-5" /> เพิ่มรายการสิ่งของ
		</button>
	</div>

	<!-- ส่วนแสดงผลความผิดพลาดจากการตรวจสอบข้อมูล -->
	{#if validationErrors.length > 0}
		<div class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
			<div class="mb-2 flex items-center gap-2 font-bold">
				<AlertCircle class="h-5 w-5" />
				พบข้อมูลไม่ถูกต้อง:
			</div>
			<ul class="list-disc space-y-1 pl-5">
				{#each validationErrors as err (err)}
					<li>{err}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<button
		type="button"
		onclick={handleNext}
		class="bg-[#013481] text-white w-full py-4 rounded-xl font-bold text-lg disabled:opacity-50 transition-all hover:bg-[#002244] shadow-md flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
	>
		ถัดไป: เลือกจุดส่งมอบ <ArrowRight class="h-5 w-5" />
	</button>
</div>

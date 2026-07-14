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
				if (!item.unit || !item.unit.trim()) {
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

<div class="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm">
	<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-primary">
				<ShieldCheck class="h-5 w-5" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 1: ข้อมูลผู้บริจาค</h3>
				<p class="text-xs font-medium text-slate-400">สำหรับติดต่อกลับกรณีฉุกเฉิน</p>
			</div>
		</div>

		<div class="space-y-4">
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-xs font-bold text-slate-700" for="donor-name">
						ชื่อ-นามสกุล / นามแฝง / องค์กร <span class="text-danger">*</span>
					</label>
					<input
						type="text"
						id="donor-name"
						bind:value={donationStore.donorName}
						placeholder="เช่น บจก. ใจดี หรือ นางสาว รักดี"
						class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-slate-800 outline-hidden transition-all focus:border-primary"
					/>
				</div>
				<div>
					<label class="mb-1.5 block text-xs font-bold text-slate-700" for="donor-phone">
						เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span>
					</label>
					<input
						type="tel"
						id="donor-phone"
						bind:value={donationStore.donorPhone}
						placeholder="สำหรับส่ง SMS ยืนยัน"
						class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-bold text-slate-800 outline-hidden transition-all focus:border-primary"
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-xs font-bold text-slate-700" for="donor-line">
						Line ID (ไม่บังคับ)
					</label>
					<input
						type="text"
						id="donor-line"
						bind:value={donationStore.donorLine}
						placeholder="ระบุไอดีไลน์ (ถ้ามี)"
						class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-slate-800 outline-hidden transition-all focus:border-primary"
					/>
				</div>
				<div>
					<label class="mb-1.5 block text-xs font-bold text-slate-700" for="donor-email">
						อีเมล (ไม่บังคับ)
					</label>
					<input
						type="email"
						id="donor-email"
						bind:value={donationStore.donorEmail}
						placeholder="ระบุที่อยู่อีเมล (ถ้ามี)"
						class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-slate-800 outline-hidden transition-all focus:border-primary"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600"
			>
				<Package class="h-5 w-5" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h3>
				<p
					class="mt-1 inline-block rounded bg-[#013365]/10 px-3 py-1 text-xs font-medium text-[#013365]"
				>
					💡 เลือกลบรายการที่ไม่ต้องการบริจาคออก และปรับระบุจำนวนที่คุณต้องการบริจาคได้ตามสะดวก
				</p>
			</div>
		</div>

		{#if donationStore.items.length > 0}
			<div class="mb-6 space-y-4">
				{#each donationStore.items as item, idx (item.id)}
					<div
						class="relative flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5"
					>
						<button
							type="button"
							onclick={() => donationStore.removeItem(item.id)}
							class="absolute top-2 right-2 rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
							title="ลบรายการ"
						>
							<Trash2 class="h-5.5 w-5.5" />
						</button>

						<div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
							<div>
								<label class="mb-1 block text-xs font-bold text-slate-600" for="category-{item.id}">
									หมวดหมู่
								</label>
								<select
									id="category-{item.id}"
									bind:value={item.category}
									class="w-full appearance-none rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden focus:border-primary"
								>
									<option value="" disabled selected>เลือกหมวดหมู่</option>
									{#each PUBLIC_DONATION_CATEGORIES as cat (cat.value)}
										<option value={cat.value}>{cat.label}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="mb-1 block text-xs font-bold text-slate-600" for="name-{item.id}">
									ชื่อสิ่งของ
								</label>
								<input
									type="text"
									id="name-{item.id}"
									placeholder="เช่น น้ำดื่มขวด 600ml"
									bind:value={item.name}
									class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 text-slate-800 outline-hidden focus:border-primary"
								/>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
							<div class="col-span-1">
								<label class="mb-1 block text-xs font-bold text-slate-600" for="amount-{item.id}">
									ปริมาณ
								</label>
								<input
									type="number"
									id="amount-{item.id}"
									min="1"
									bind:value={item.amount}
									class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-bold text-slate-800 outline-hidden focus:border-primary"
								/>
							</div>
							<div class="col-span-1">
								<label class="mb-1 block text-xs font-bold text-slate-600" for="unit-{item.id}">
									หน่วย
								</label>
								<input
									type="text"
									id="unit-{item.id}"
									placeholder="เช่น แพ็ค, ลัง, ชิ้น"
									bind:value={item.unit}
									class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden focus:border-primary"
								/>
							</div>
							<div class="col-span-2 md:col-span-1">
								<label
									class="mb-1 block text-xs font-bold text-slate-600"
									for="condition-{item.id}"
								>
									สภาพสิ่งของ
								</label>
								<select
									id="condition-{item.id}"
									bind:value={item.condition}
									class="w-full appearance-none rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden focus:border-primary"
								>
									<option value="">เลือกสภาพสิ่งของ</option>
									<option value="new">ของใหม่ 100%</option>
									<option value="used">ของมือสอง สภาพดี</option>
								</select>
							</div>
						</div>

						<div>
							<label class="mb-1 block text-xs font-bold text-slate-600" for="remark-{item.id}">
								หมายเหตุเพิ่มเติม (Optional)
							</label>
							<input
								type="text"
								id="remark-{item.id}"
								placeholder="เช่น ข้าวกล่องมังสวิรัติ, เสื้อผ้าเด็ก 5 ขวบ"
								bind:value={item.remark}
								class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden focus:border-primary"
							/>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => donationStore.addItem()}
			class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-blue-50/50 py-4 font-bold text-primary transition-colors hover:bg-muted/10"
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
		class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#013481] py-4 text-lg font-bold text-white shadow-md transition-all hover:bg-[#002244] active:scale-95 disabled:opacity-50"
	>
		ถัดไป: เลือกจุดส่งมอบ <ArrowRight class="h-5 w-5" />
	</button>
</div>

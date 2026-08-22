<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Package from '@lucide/svelte/icons/package';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { toast } from 'svelte-sonner';
	import { getDonationStore } from '../../../routes/(public)/donations/donation.svelte';
	import { PUBLIC_DONATION_CATEGORIES } from '$lib/features/donations';

	const donationStore = getDonationStore();

	/** Thai label for a category value, for the read-only solicited view. */
	function categoryLabel(value: string | undefined): string {
		return PUBLIC_DONATION_CATEGORIES.find((c) => c.value === value)?.label ?? value ?? '';
	}
	let validationErrors = $state<string[]>([]);

	function handleImageUpload(index: number, e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (evt) => {
				if (donationStore.items[index]) {
					donationStore.items[index].image = (evt.target?.result as string) || '';
				}
			};
			reader.readAsDataURL(file);
		} else if (donationStore.items[index]) {
			donationStore.items[index].image = '';
		}
	}

	function removeImage(index: number) {
		if (donationStore.items[index]) {
			donationStore.items[index].image = '';
		}
	}

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

<div class="rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-xs md:p-8">
	<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
				<ShieldCheck class="h-5 w-5 text-[#013481]" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 1: ข้อมูลผู้บริจาค</h3>
				<p class="mt-1 text-sm font-medium text-slate-500">
					ข้อมูลนี้จะใช้สำหรับการติดต่อประสานงานและการออกตั๋วส่งมอบ
				</p>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<label class="mb-2 block text-sm font-bold text-slate-800" for="donor-name">
					ชื่อ-นามสกุล / ชื่อองค์กร <span class="text-red-500">*</span>
				</label>
				<input
					type="text"
					id="donor-name"
					bind:value={donationStore.donorName}
					placeholder="ระบุชื่อผู้บริจาค เช่น บจก. ใจดี หรือ นายสมชาย"
					class="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-hidden transition-colors focus:border-[#013481] focus:bg-white"
				/>
			</div>
			<div>
				<label class="mb-2 block text-sm font-bold text-slate-800" for="donor-phone">
					เบอร์โทรศัพท์ <span class="text-red-500">*</span>
				</label>
				<input
					type="tel"
					id="donor-phone"
					bind:value={donationStore.donorPhone}
					placeholder="08X-XXX-XXXX"
					class="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-bold text-slate-800 outline-hidden transition-colors focus:border-[#013481] focus:bg-white"
				/>
			</div>
			<div>
				<label class="mb-2 block text-sm font-bold text-slate-800" for="donor-line">
					LINE ID (ทางเลือก)
				</label>
				<input
					type="text"
					id="donor-line"
					bind:value={donationStore.donorLine}
					placeholder="ไอดีไลน์สำหรับการติดต่อ"
					class="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-hidden transition-colors focus:border-[#013481] focus:bg-white"
				/>
			</div>
			<div>
				<label class="mb-2 block text-sm font-bold text-slate-800" for="donor-email">
					อีเมล (ทางเลือก)
				</label>
				<input
					type="email"
					id="donor-email"
					bind:value={donationStore.donorEmail}
					placeholder="example@email.com"
					class="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 outline-hidden transition-colors focus:border-[#013481] focus:bg-white"
				/>
			</div>
		</div>
	</div>

	<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
	<div>
		<div class="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff8e1]">
				<Package class="h-5 w-5 text-[#fbbc04]" />
			</div>
			<div>
				<h3 class="text-xl font-bold text-slate-800">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h3>
				<p
					class="mt-1 inline-block rounded bg-[#013365]/10 px-3 py-1 text-sm font-medium text-[#013365]"
				>
					{donationStore.flowMode === 'solicited'
						? '💡 เลือกลบรายการที่ไม่ต้องการบริจาคออก และปรับระบุจำนวนที่คุณต้องการบริจาคได้ตามสะดวก'
						: 'ระบุรายการสิ่งของที่คุณจะนำมามอบให้'}
				</p>
			</div>
		</div>

		<div class="space-y-4">
			{#each donationStore.items as item, idx (item.id)}
				<div
					class="relative flex flex-col gap-3 rounded-xl border border-slate-200 bg-[#f8f9fa] p-5"
				>
					<button
						type="button"
						onclick={() => donationStore.removeItem(item.id)}
						class="absolute top-2 right-2 cursor-pointer rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
						title="ลบรายการนี้"
						aria-label="ลบรายการนี้"
					>
						<Trash2 class="h-4.5 w-4.5" />
					</button>

					<div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
						<div>
							<label class="mb-1 block text-xs font-bold text-slate-600" for="category-{item.id}">
								หมวดหมู่
							</label>
							{#if donationStore.flowMode === 'solicited'}
								<input
									type="text"
									id="category-{item.id}"
									readonly
									value={categoryLabel(item.category)}
									class="w-full cursor-not-allowed rounded-xl border-2 border-transparent bg-slate-100 p-3 font-medium text-slate-500 outline-hidden"
								/>
							{:else}
								<select
									id="category-{item.id}"
									bind:value={item.category}
									class="w-full appearance-none rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
								>
									<option value="" disabled>-- เลือกหมวดหมู่ --</option>
									{#each PUBLIC_DONATION_CATEGORIES as cat (cat.value)}
										<option value={cat.value}>{cat.label}</option>
									{/each}
									<option value="other">อื่นๆ (ระบุในหมายเหตุ)</option>
								</select>
							{/if}
						</div>
						<div>
							<label class="mb-1 block text-xs font-bold text-slate-600" for="name-{item.id}">
								ประเภทสิ่งของ
							</label>
							{#if donationStore.flowMode === 'solicited'}
								<input
									type="text"
									id="name-{item.id}"
									readonly
									value={item.name}
									class="w-full cursor-not-allowed rounded-xl border-2 border-transparent bg-slate-100 p-3 font-medium text-slate-500 outline-hidden"
								/>
							{:else}
								<input
									type="text"
									id="name-{item.id}"
									placeholder="ระบุชื่อสิ่งของ เช่น น้ำดื่ม 600ml หรือ ปีกไก่แช่แข็ง"
									bind:value={item.name}
									class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
								/>
							{/if}
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
								class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-bold text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
							/>
						</div>
						<div class="col-span-1">
							<label class="mb-1 block text-xs font-bold text-slate-600" for="unit-{item.id}">
								หน่วย
							</label>
							{#if donationStore.flowMode === 'solicited'}
								<input
									type="text"
									id="unit-{item.id}"
									readonly
									value={item.unit}
									class="w-full cursor-not-allowed rounded-xl border-2 border-transparent bg-slate-100 p-3 font-medium text-slate-500 outline-hidden"
								/>
							{:else}
								<input
									type="text"
									id="unit-{item.id}"
									placeholder="แพ็ค, ลัง, ชิ้น"
									bind:value={item.unit}
									class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
								/>
							{/if}
						</div>
						<div class="col-span-2 md:col-span-1">
							<label class="mb-1 block text-xs font-bold text-slate-600" for="condition-{item.id}">
								สภาพสิ่งของ
							</label>
							<select
								id="condition-{item.id}"
								bind:value={item.condition}
								class="w-full appearance-none rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
							>
								<option value="new">ของใหม่ 100%</option>
								<option value="used">ของมือสอง สภาพดี</option>
								<option value="other">อื่นๆ</option>
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
							class="w-full rounded-xl border-2 border-slate-200 bg-white p-3 font-medium text-slate-800 outline-hidden transition-colors focus:border-[#013481]"
						/>
					</div>

					<!-- Optional Image Attachment — unsolicited flow only, per v8.5 -->
					{#if donationStore.flowMode !== 'solicited'}
						<div>
							<label
								class="mb-1 block text-xs font-bold text-slate-600"
								for="file-upload-{item.id}"
							>
								แนบรูปภาพสิ่งของที่จะบริจาค (ไม่บังคับ)
							</label>
							<input
								type="file"
								id="file-upload-{item.id}"
								accept="image/*"
								onchange={(e) => handleImageUpload(idx, e)}
								class="w-full rounded-xl border-2 border-slate-200 bg-white p-1 text-sm text-slate-500 file:mr-4 file:cursor-pointer file:rounded-xl file:border-0 file:bg-blue-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-[#013481] file:transition-colors hover:file:bg-blue-100"
							/>
							{#if item.image}
								<div
									class="group relative mt-2 h-20 w-20 overflow-hidden rounded-xl border border-slate-200"
								>
									<img src={item.image} alt="Preview" class="h-full w-full object-cover" />
									<button
										type="button"
										onclick={() => removeImage(idx)}
										class="absolute top-1 right-1 cursor-pointer rounded-full bg-white/90 p-1 text-red-500 opacity-0 shadow-xs transition-opacity group-hover:opacity-100 hover:bg-red-50"
										aria-label="ลบรูปภาพ"
									>
										<Trash2 class="h-3 w-3" />
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			{#if donationStore.flowMode !== 'solicited'}
				<button
					type="button"
					onclick={() => donationStore.addItem()}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#013481]/30 bg-blue-50/50 py-4 font-bold text-[#013481] transition-colors hover:bg-blue-50"
				>
					<PlusCircle class="h-5 w-5" /> เพิ่มรายการสิ่งของ
				</button>
			{/if}
		</div>
	</div>

	<!-- Validation Errors -->
	{#if validationErrors.length > 0}
		<div class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
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

	<div class="pt-8">
		<button
			type="button"
			onclick={handleNext}
			class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#013481] py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-[#002244] active:scale-95 disabled:opacity-50"
		>
			ถัดไป: เลือกจุดส่งมอบ <ArrowRight class="h-5 w-5" />
		</button>
	</div>
</div>

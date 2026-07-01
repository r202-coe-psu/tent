<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Box from '@lucide/svelte/icons/box';
	import Plus from '@lucide/svelte/icons/plus';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import { donationStore } from '../../../routes/public/donations/donation.svelte';

	// หมวดหมู่ตาม supply_item.category (schema.md §4.1)
	const categoryOptions = [
		{ value: 'food', label: 'อาหาร' },
		{ value: 'water', label: 'น้ำดื่ม' },
		{ value: 'medicine', label: 'ยา/เวชภัณฑ์' },
		{ value: 'clothing', label: 'เสื้อผ้า' },
		{ value: 'hygiene', label: 'ของใช้/สุขอนามัย' },
		{ value: 'bedding', label: 'เครื่องนอน' },
		{ value: 'equipment', label: 'อุปกรณ์' },
		{ value: 'other', label: 'อื่นๆ' }
	];

	// แปลงหน่วยจาก catalog (canonical อังกฤษ) ⇄ ไทยอ่านง่าย
	const UNIT_LABEL: Record<string, string> = {
		kg: 'กก.',
		bottle: 'ขวด',
		bar: 'ก้อน',
		piece: 'ชิ้น',
		tablet: 'เม็ด',
		box: 'กล่อง',
		pack: 'แพ็ค'
	};

	const REVERSE_UNIT_LABEL: Record<string, string> = {
		'กก.': 'kg',
		'ขวด': 'bottle',
		'ก้อน': 'bar',
		'ชิ้น': 'piece',
		'เม็ด': 'tablet',
		'กล่อง': 'box',
		'แพ็ค': 'pack'
	};

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
				<Input type="text" id="donor-line" bind:value={donationStore.donorLine} class="mt-1.5" />
			</div>

			<div>
				<Label class="block text-xs font-bold text-foreground" for="donor-email">
					อีเมล (ไม่บังคับ)
				</Label>
				<Input type="email" id="donor-email" bind:value={donationStore.donorEmail} class="mt-1.5" />
			</div>
		</div>
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
				<h2 class="text-base font-bold text-foreground">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h2>
				<p class="text-xs text-muted-foreground">ระบุรายการสิ่งของที่คุณจะนำมามอบให้</p>
			</div>
		</div>

		{#if donationStore.items.length > 0}
			<div class="mb-4 flex flex-col gap-3">
				{#each donationStore.items as item, index (item.id ?? index)}
					<div class="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/10 p-3">
						<div class="flex items-center gap-2.5">
							<Input
								type="text"
								placeholder="เช่น ข้าวสาร, แพมเพิสเด็ก"
								bind:value={item.name}
								class="flex-1"
							/>
							<Input type="number" placeholder="จำนวน" bind:value={item.amount} class="w-20" />
							<Input
								type="text"
								placeholder="หน่วย เช่น แพ็ค, ชิ้น"
								value={UNIT_LABEL[item.unit] ?? item.unit}
								oninput={(e) => {
									const val = e.currentTarget.value;
									item.unit = REVERSE_UNIT_LABEL[val] ?? val;
								}}
								class="w-24"
							/>
							<button
								type="button"
								onclick={() => donationStore.removeItem(index)}
								class="px-2 text-xs font-bold text-danger hover:underline"
							>
								ลบ
							</button>
						</div>
						<div class="flex flex-col gap-2 md:flex-row">
							<Select type="single" bind:value={item.category}>
								<SelectTrigger class="w-full md:w-44">
									{categoryOptions.find((o) => o.value === item.category)?.label ??
										'หมวดหมู่ (ไม่บังคับ)'}
								</SelectTrigger>
								<SelectContent>
									{#each categoryOptions as opt (opt.value)}
										<SelectItem value={opt.value} label={opt.label} />
									{/each}
								</SelectContent>
							</Select>
							<Input
								type="text"
								placeholder="สภาพของ เช่น ของใหม่ 100%"
								bind:value={item.condition}
								class="flex-1"
							/>
							<Input
								type="text"
								placeholder="หมายเหตุ (ไม่บังคับ)"
								bind:value={item.note}
								class="flex-1"
							/>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<button
			type="button"
			onclick={() => donationStore.addItem()}
			class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3 text-xs font-bold text-primary transition-colors hover:bg-muted/30"
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
			<ul class="list-disc space-y-1 pl-5">
				{#each validationErrors as err, i (i)}
					<li>{err}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Form Submit / Next Button -->
	<button
		type="button"
		onclick={handleNext}
		class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-xs font-bold text-white transition-colors hover:bg-primary-dark"
	>
		ถัดไป: เลือกจุดส่งมอบ
		<span>→</span>
	</button>
</div>

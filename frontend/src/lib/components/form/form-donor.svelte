<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Box from '@lucide/svelte/icons/box';
	import Plus from '@lucide/svelte/icons/plus';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import {
		Select,
		SelectTrigger,
		SelectContent,
		SelectItem,
		SelectValue
	} from '$lib/components/ui/select';
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

<div class="rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
	<!-- ส่วนที่ 1: ข้อมูลผู้บริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
			<div
				class="flex size-10 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-blue-600"
			>
				<User class="size-6" />
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
	</div>

	<!-- ส่วนที่ 2: รายละเอียดสิ่งของบริจาค -->
	<div class="mb-8">
		<div class="mb-6 flex items-center gap-2.5 border-b border-border/55 pb-3">
			<div
				class="flex size-10 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-amber-600"
			>
				<Box class="size-6" />
			</div>
			<div>
				<h2 class="text-base font-bold text-foreground">ส่วนที่ 2: รายละเอียดสิ่งของบริจาค</h2>
				<p class="rounded-sm bg-primary-dark/10 p-1 text-xs text-primary-dark">
					💡 เลือกลบรายการที่ไม่ต้องการบริจาคออก และปรับระบุจำนวนที่คุณต้องการบริจาคได้ตามสะดวก
				</p>
			</div>
		</div>

		{#if donationStore.items.length > 0}
			<div class="mb-4 flex flex-col gap-4">
				{#each donationStore.items as item, index (item.id)}
					<div
						class="relative rounded-lg border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
					>
						<Button
							variant="ghost"
							size="icon"
							class="absolute top-2 right-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
							title="ลบรายการ"
							onclick={() => donationStore.removeItem(item.id)}
						>
							<svg viewBox="0 0 24 24" class="h-5 w-5 fill-current">
								<path
									d="M9 3v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5V3H9m0 5h2v9H9V8m4 0h2v9h-2V8Z"
								/>
							</svg>
						</Button>

						<div class="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div class="flex w-full flex-col gap-1.5">
								<Label class="text-xs font-bold text-foreground">หมวดหมู่</Label>
								<Select type="single" bind:value={item.category}>
									<SelectTrigger class="h-full w-full">
										<SelectValue placeholder="เลือกหมวดหมู่" />
									</SelectTrigger>
									<SelectContent>
										{#each PUBLIC_DONATION_CATEGORIES as cat}
											<SelectItem value={cat.value} label={cat.label}>{cat.label}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label class="text-xs font-bold text-foreground">ชื่อสิ่งของ</Label>
								<Input type="text" placeholder="เช่น น้ำดื่มขวด 600ml" bind:value={item.name} />
							</div>
						</div>

						<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
							<div class="flex flex-col gap-1.5">
								<Label class="text-xs font-bold text-foreground">ปริมาณ</Label>
								<Input type="number" bind:value={item.amount} min="1" />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label class="text-xs font-bold text-foreground">หน่วย</Label>
								<Input type="text" bind:value={item.unit} />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label class="text-xs font-bold text-foreground">สภาพสิ่งของ</Label>
								<Input type="text" bind:value={item.condition} />
							</div>
						</div>

						<div class="mt-4 flex flex-col gap-1.5">
							<Label class="text-xs font-bold text-foreground">หมายเหตุเพิ่มเติม (Optional)</Label>
							<Input
								type="text"
								placeholder="เช่น ข้าวกล่องมังสวิรัติ, เสื้อผ้าเด็ก 5 ขวบ"
								bind:value={item.remark}
							/>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<Button
			variant="outline"
			onclick={() => donationStore.addItem()}
			class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-6 text-xs font-bold text-primary transition-colors hover:bg-muted/30"
		>
			<Plus class="size-6" />
			เพิ่มรายการสิ่งของ
		</Button>
	</div>

	<!-- ส่วนแสดงผลความผิดพลาดจากการตรวจสอบข้อมูล -->
	{#if validationErrors.length > 0}
		<div class="mb-6 rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger">
			<div class="mb-2 flex items-center gap-2 font-bold">
				<AlertCircle class="size-6" />
				พบข้อมูลไม่ถูกต้อง:
			</div>
			<ul class="list-disc space-y-1 pl-5">
				{#each validationErrors as err}
					<li>{err}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Form Submit / Next Button -->
	<Button
		onclick={handleNext}
		class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-6 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary-dark"
	>
		ถัดไป: เลือกจุดส่งมอบ
		<span>→</span>
	</Button>
</div>

<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';

	interface Props {
		onclose: () => void;
		onsubmit: (input: {
			name: string;
			target: number;
			location: string;
			category?: string;
			unit?: string;
			urgency?: 'critical' | 'important' | 'normal';
			description?: string;
		}) => void;
	}

	let { onclose, onsubmit }: Props = $props();

	let itemTitle = $state('');
	let category = $state('ถูกกำหนดอัตโนมัติ');
	let targetQty = $state<number | ''>('');
	let unit = $state('-- โปรดเลือกรายการสิ่งของก่อน --');
	let urgency = $state<'critical' | 'important' | 'normal'>('normal');
	let description = $state('');

	// Auto-fill category and unit based on search / item title
	$effect(() => {
		const lower = itemTitle.toLowerCase();
		if (!lower) {
			category = 'ถูกกำหนดอัตโนมัติ';
			unit = '-- โปรดเลือกรายการสิ่งของก่อน --';
			return;
		}

		if (lower.includes('ข้าว') || lower.includes('อาหาร') || lower.includes('ปลากระป๋อง')) {
			category = 'อาหาร/เครื่องดื่ม';
			unit = lower.includes('ข้าว') ? 'ถุง (5kg)' : 'แพ็ค';
		} else if (lower.includes('น้ำ')) {
			category = 'อาหาร/เครื่องดื่ม';
			unit = 'ขวด';
		} else if (lower.includes('ยา') || lower.includes('พารา') || lower.includes('เวชภัณฑ์')) {
			category = 'ยารักษาโรค/เวชภัณฑ์';
			unit = 'กล่อง';
		} else if (
			lower.includes('ผ้าห่ม') ||
			lower.includes('สบู่') ||
			lower.includes('เสื้อผ้า') ||
			lower.includes('ของใช้')
		) {
			category = 'ของใช้ทั่วไป';
			unit = lower.includes('ผ้าห่ม') ? 'ผืน' : lower.includes('สบู่') ? 'ก้อน' : 'ชิ้น';
		} else {
			category = 'อื่นๆ';
			unit = 'ชิ้น';
		}
	});

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!itemTitle.trim()) {
			toast.error('กรุณาระบุชื่อรายการสิ่งของ');
			return;
		}
		if (!targetQty || targetQty <= 0) {
			toast.error('กรุณาระบุจำนวนเป้าหมายที่ถูกต้อง');
			return;
		}
		if (!description.trim()) {
			toast.error('กรุณาระบุเหตุผลความจำเป็น');
			return;
		}

		onsubmit({
			name: itemTitle,
			target: Number(targetQty),
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			category,
			unit: unit.startsWith('--') ? 'ชิ้น' : unit,
			urgency,
			description
		});
	}

	function handleUploadClick() {
		toast.info('ระบบอัปโหลดรูปภาพจำลองเปิดทำงานแล้ว');
	}

	function handleAddNewItem() {
		if (itemTitle.trim()) {
			toast.success(`เพิ่มรายการสิ่งของใหม่ "${itemTitle}" เข้าระบบชั่วคราว`);
		} else {
			toast.error('กรุณาพิมพ์ชื่อสิ่งของก่อนเพิ่ม');
		}
	}
</script>

<div class="flex flex-col gap-6">
	<!-- Top Bar and Banner -->
	<div class="flex flex-col gap-4">
		<button
			type="button"
			onclick={onclose}
			class="flex w-fit items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าจัดการความต้องการ
		</button>

		<div
			class="flex flex-col justify-start rounded-2xl bg-primary p-6 text-primary-foreground shadow-xs"
		>
			<h2 class="flex items-center gap-2 text-lg font-bold">
				<Megaphone class="h-5 w-5 text-primary-foreground" />
				สร้างประกาศขอรับบริจาค
			</h2>
			<p class="mt-1.5 text-xs text-primary-foreground/70">
				กำหนดรายการสั่งของและจำนวนที่ต้องการ เพื่อประกาศให้ประชาชนทราบผ่านหน้าเว็บไซต์
			</p>
		</div>
	</div>

	<!-- Form Layout -->
	<form
		onsubmit={handleSubmit}
		class="space-y-8 rounded-2xl border border-border bg-card p-6 shadow-xs"
	>
		<!-- Section 1 -->
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
				<span
					class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
					>1</span
				>
				ข้อมูลสิ่งของ (Item Details)
			</h3>

			<div class="grid gap-6 md:grid-cols-2">
				<!-- Item Title -->
				<div class="space-y-2 md:col-span-2">
					<label for="item-title" class="text-xs font-bold text-foreground">
						ชื่อรายการสิ่งของ (Item Title) <span class="text-destructive">*</span>
					</label>
					<div class="flex gap-2">
						<div class="relative flex-1">
							<Search
								class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								id="item-title"
								bind:value={itemTitle}
								placeholder="พิมพ์เพื่อค้นหารายการสิ่งของ (เช่น น้ำดื่ม)..."
								class="h-10 pl-10 text-xs"
							/>
						</div>
						<Button
							type="button"
							onclick={handleAddNewItem}
							class="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
						>
							<Plus class="h-3.5 w-3.5" />
							เพิ่มรายการสิ่งของใหม่
						</Button>
					</div>
				</div>

				<!-- Category -->
				<div class="space-y-2">
					<label for="category" class="text-xs font-bold text-foreground">
						หมวดหมู่ (Category) <span class="text-destructive">*</span>
					</label>
					<Input
						id="category"
						value={category}
						disabled
						class="h-10 bg-muted/50 text-xs font-medium text-muted-foreground select-none"
					/>
				</div>

				<!-- Image upload -->
				<div class="space-y-2">
					<label for="image-upload" class="text-xs font-bold text-foreground">
						รูปภาพประกอบ (Item Image)
					</label>
					<button
						type="button"
						onclick={handleUploadClick}
						class="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/30"
					>
						<Upload class="h-4 w-4" />
						อัปโหลดรูปภาพ
					</button>
				</div>
			</div>
		</div>

		<hr class="border-border/60" />

		<!-- Section 2 -->
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
				<span
					class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
					>2</span
				>
				เป้าหมายและเหตุผล (Target & Storytelling)
			</h3>

			<div class="grid gap-6 md:grid-cols-2">
				<!-- Target Qty -->
				<div class="space-y-2">
					<label for="target-qty" class="text-xs font-bold text-foreground">
						จำนวนเป้าหมายที่ต้องการ (Target Quantity) <span class="text-destructive">*</span>
					</label>
					<Input
						id="target-qty"
						type="number"
						min="1"
						bind:value={targetQty}
						placeholder="ระบุตัวเลข"
						class="h-10 text-xs"
					/>
				</div>

				<!-- Unit -->
				<div class="space-y-2">
					<label for="unit" class="text-xs font-bold text-foreground">
						หน่วยนับ (Unit of Measurement) <span class="text-destructive">*</span>
					</label>
					<select
						id="unit"
						bind:value={unit}
						class="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background file:border-0 file:bg-transparent file:text-xs file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if unit.startsWith('--')}
							<option disabled value={unit}>{unit}</option>
						{/if}
						<option value="ชิ้น">ชิ้น</option>
						<option value="ขวด">ขวด</option>
						<option value="แพ็ค">แพ็ค</option>
						<option value="ถุง">ถุง</option>
						<option value="ถุง (5kg)">ถุง (5kg)</option>
						<option value="กล่อง">กล่อง</option>
						<option value="ผืน">ผืน</option>
						<option value="ก้อน">ก้อน</option>
						<option value="กก.">กก.</option>
					</select>
				</div>

				<!-- Urgency Level -->
				<div class="space-y-2 md:col-span-2">
					<span class="text-xs font-bold text-foreground">
						ระดับความเร่งด่วน (Urgency Level) <span class="text-destructive">*</span>
					</span>
					<div class="grid grid-cols-3 gap-3">
						<button
							type="button"
							onclick={() => (urgency = 'critical')}
							class="flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all
							{urgency === 'critical'
								? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400'
								: 'border-border bg-card hover:bg-muted/50'}"
						>
							<span class="h-2 w-2 rounded-full bg-red-600"></span>
							วิกฤต (ปักหมุด)
						</button>
						<button
							type="button"
							onclick={() => (urgency = 'important')}
							class="flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all
							{urgency === 'important'
								? 'border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400'
								: 'border-border bg-card hover:bg-muted/50'}"
						>
							<span class="h-2 w-2 rounded-full bg-amber-500"></span>
							สำคัญ
						</button>
						<button
							type="button"
							onclick={() => (urgency = 'normal')}
							class="flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all
							{urgency === 'normal'
								? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
								: 'border-border bg-card hover:bg-muted/50'}"
						>
							<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
							ทั่วไป
						</button>
					</div>
				</div>

				<!-- Description / Reason -->
				<div class="space-y-2 md:col-span-2">
					<label for="description" class="text-xs font-bold text-foreground">
						เหตุผลความจำเป็น (Description/Reason) <span class="text-destructive">*</span>
					</label>
					<textarea
						id="description"
						bind:value={description}
						placeholder="ระบุเหตุผลเพื่อกระตุ้นการบริจาค เช่น 'เนื่องจากไฟฟ้าตัดขาด คลินิกในศูนย์ฯ จำเป็นต้องใช้เครื่องปั่นไฟเพื่อแช่ยาเวชภัณฑ์ด่วน'"
						class="flex min-h-[80px] w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
					></textarea>
				</div>
			</div>
		</div>

		<!-- Action Buttons -->
		<div class="flex justify-end gap-3 pt-4">
			<Button
				type="button"
				variant="outline"
				onclick={onclose}
				class="h-10 rounded-xl px-6 text-xs font-bold"
			>
				ยกเลิก
			</Button>
			<Button
				type="submit"
				class="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
			>
				<Megaphone class="h-4 w-4" />
				ประกาศขอรับบริจาคผ่านหน้าหลัก
			</Button>
		</div>
	</form>
</div>

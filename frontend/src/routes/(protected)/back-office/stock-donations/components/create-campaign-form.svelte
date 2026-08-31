<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import { suggestNeedDefaults } from '$lib/features/operations';
	import { persistQty, qtyGt } from '$lib/utils/qty';

	interface Props {
		onclose: () => void;
		onsubmit: (input: {
			name: string;
			target: string;
			location: string;
			category?: string;
			unit?: string;
			urgency?: 'critical' | 'important' | 'normal';
			description?: string;
		}) => void;
	}

	let { onclose, onsubmit }: Props = $props();

	let itemTitle = $state('');
	// `null` = "still following the suggestion". Set the moment staff pick for
	// themselves, so a later edit to the item name cannot undo their choice.
	let categoryChoice = $state<string | null>(null);
	let targetQty = $state('');
	const STANDARD_UNITS = [
		'ชิ้น',
		'กล่อง',
		'แพ็ค',
		'ขวด',
		'กระป๋อง',
		'กิโลกรัม',
		'ถุง',
		'ผืน',
		'ชุด',
		'ก้อน',
		'ลัง',
		'ม้วน',
		'คู่',
		'แผง',
		'ซอง'
	];

	let unitChoice = $state<string | null>(null);
	let customUnit = $state('');
	let urgency = $state<'critical' | 'important' | 'normal'>('critical');
	let imageUrl = $state('');
	let description = $state('');

	const suggested = $derived(suggestNeedDefaults(itemTitle));
	const category = $derived(categoryChoice ?? suggested.category ?? 'อาหารและเครื่องดื่ม');
	const selectedUnitOption = $derived(unitChoice ?? suggested.unit ?? 'ชิ้น');
	const finalUnit = $derived(
		selectedUnitOption === 'custom' ? customUnit.trim() : selectedUnitOption
	);

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!itemTitle.trim()) {
			toast.error('กรุณาระบุชื่อรายการสิ่งของ');
			return;
		}
		if (!targetQty.trim() || !qtyGt(targetQty, 0)) {
			toast.error('กรุณาระบุจำนวนเป้าหมายที่ถูกต้อง');
			return;
		}
		if (!description.trim()) {
			toast.error('กรุณาระบุเหตุผลหรือรายละเอียดเพิ่มเติม');
			return;
		}

		onsubmit({
			name: itemTitle.trim(),
			target: persistQty(targetQty),
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			category: category.trim() || 'ของใช้ทั่วไป',
			unit: finalUnit || 'ชิ้น',
			urgency,
			description: description.trim()
		});
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Top Dark Navy Banner -->
	<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
		<button
			type="button"
			onclick={onclose}
			class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-blue-200 transition-colors hover:text-white"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าจัดการความต้องการ
		</button>
		<div class="flex items-center gap-2.5">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
				<Megaphone class="h-5 w-5" />
			</div>
			<h2 class="text-base font-bold text-white md:text-lg">สร้างประกาศขอรับบริจาค</h2>
		</div>
		<p class="mt-1 text-xs text-blue-100/80">
			กำหนดรายการสิ่งของและจำนวนที่ต้องการ เพื่อประกาศให้ประชาชนทราบผ่านหน้าเว็บไซต์
		</p>
	</div>

	<!-- Form Body -->
	<form onsubmit={handleSubmit} class="space-y-6 p-6 md:p-8">
		<div class="space-y-4">
			<h3 class="flex items-center gap-2 text-xs font-bold text-foreground md:text-sm">
				<PlusCircle class="h-4 w-4 text-muted-foreground" />
				รายละเอียดสิ่งของ
			</h3>

			<!-- Item Title -->
			<div>
				<label for="campaign-item-title" class="mb-1.5 block text-xs font-bold text-foreground">
					ชื่อสิ่งของ (Item Name) <span class="text-rose-500">*</span>
				</label>
				<div class="relative">
					<Search
						class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id="campaign-item-title"
						type="text"
						placeholder="พิมพ์ชื่อเพื่อค้นหาหรือระบุสิ่งของ..."
						bind:value={itemTitle}
						class="h-10 rounded-xl pl-9 text-xs"
					/>
				</div>
			</div>

			<!-- Category -->
			<div>
				<label for="campaign-item-category" class="mb-1.5 block text-xs font-bold text-foreground">
					หมวดหมู่สิ่งของ (Category)
				</label>
				<select
					id="campaign-item-category"
					value={category}
					onchange={(e) => (categoryChoice = e.currentTarget.value)}
					class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
				>
					<option value="อาหารและเครื่องดื่ม">อาหารและเครื่องดื่ม (Food & Beverage)</option>
					<option value="ยารักษาโรคและเวชภัณฑ์">ยารักษาโรคและเวชภัณฑ์ (Medical Supplies)</option>
					<option value="ของใช้ทั่วไปและสุขอนามัย"
						>ของใช้ทั่วไปและสุขอนามัย (General & Hygiene)</option
					>
					<option value="เครื่องนุ่งห่มและที่นอน"
						>เครื่องนุ่งห่มและที่นอน (Clothing & Bedding)</option
					>
					<option value="แม่และเด็ก">แม่และเด็ก (Mother & Child)</option>
					<option value="อุปกรณ์และเครื่องมือช่าง"
						>อุปกรณ์และเครื่องมือช่าง (Tools & Equipment)</option
					>
					<option value="อื่นๆ">อื่นๆ (Other)</option>
				</select>
			</div>

			<!-- Target Qty and Unit (2 columns) -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label for="campaign-target-qty" class="mb-1.5 block text-xs font-bold text-foreground">
						จำนวนเป้าหมาย (Target Quantity) <span class="text-rose-500">*</span>
					</label>
					<Input
						id="campaign-target-qty"
						type="text"
						inputmode="decimal"
						placeholder="เช่น 100, 500"
						bind:value={targetQty}
						class="h-10 rounded-xl text-xs"
					/>
				</div>

				<div>
					<label for="campaign-item-unit" class="mb-1.5 block text-xs font-bold text-foreground">
						หน่วยนับ (Unit of Measure)
					</label>
					<div class="space-y-2">
						<select
							id="campaign-item-unit"
							value={selectedUnitOption}
							onchange={(e) => (unitChoice = e.currentTarget.value)}
							class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
						>
							{#each STANDARD_UNITS as option (option)}
								<option value={option}>{option}</option>
							{/each}
							<option value="custom">ระบุหน่วยเอง (Custom)...</option>
						</select>
						{#if selectedUnitOption === 'custom'}
							<Input
								type="text"
								placeholder="พิมพ์ระบุหน่วยนับ..."
								bind:value={customUnit}
								class="h-9 rounded-xl text-xs"
							/>
						{/if}
					</div>
				</div>
			</div>

			<!-- Urgency Level and Image URL (2 columns) -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label for="campaign-urgency" class="mb-1.5 block text-xs font-bold text-foreground">
						ความเร่งด่วน (Urgency Level)
					</label>
					<select
						id="campaign-urgency"
						bind:value={urgency}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
					>
						<option value="critical">วิกฤต (Critical)</option>
						<option value="important">สำคัญ (Important)</option>
						<option value="normal">ปกติ (Normal)</option>
					</select>
				</div>

				<div>
					<label for="campaign-image-url" class="mb-1.5 block text-xs font-bold text-foreground">
						ภาพประกอบสิ่งของ (Image URL - Optional)
					</label>
					<Input
						id="campaign-image-url"
						type="url"
						placeholder="https://example.com/image.png"
						bind:value={imageUrl}
						class="h-10 rounded-xl text-xs"
					/>
				</div>
			</div>

			<!-- Reason / Details -->
			<div>
				<label for="campaign-description" class="mb-1.5 block text-xs font-bold text-foreground">
					เหตุผลหรือรายละเอียดเพิ่มเติม (Reason / Details) <span class="text-rose-500">*</span>
				</label>
				<textarea
					id="campaign-description"
					rows="3"
					placeholder="ระบุวัตถุประสงค์ในการประกาศขอรับ เช่น สำหรับใช้ทำอาหารแจกจ่ายประจำวัน หรือ สำหรับผู้ประสบภัยที่บ้านเรือนพังเสียหาย..."
					bind:value={description}
					class="w-full rounded-xl border border-border/80 bg-card p-3 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
				></textarea>
			</div>
		</div>

		<!-- Footer Action Buttons -->
		<div class="flex items-center justify-end gap-3 border-t border-border/60 pt-6">
			<Button
				variant="ghost"
				type="button"
				onclick={onclose}
				class="h-10 rounded-xl px-5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				ยกเลิก
			</Button>

			<Button
				type="submit"
				class="flex h-10 items-center gap-2 rounded-xl bg-[#002D5B] px-6 text-xs font-bold text-white shadow-sm hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				<Megaphone class="h-4 w-4" />
				ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ
			</Button>
		</div>
	</form>
</div>

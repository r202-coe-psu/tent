<script lang="ts">
	import type { MasterDataItem } from '$lib/features/master-data';
	import { findDuplicateLabel } from '$lib/features/master-data';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';

	let {
		open,
		editingItem,
		existingItems,
		isPending = false,
		onClose,
		onSave
	} = $props<{
		open: boolean;
		editingItem: MasterDataItem | null;
		existingItems: readonly MasterDataItem[];
		isPending?: boolean;
		onClose: () => void;
		onSave: (data: {
			code: string;
			label_th: string;
			label_en: string;
			category: 'operational' | 'controlled';
			description: string;
			is_default: boolean;
		}) => Promise<void>;
	}>();

	let formCode = $state('');
	let formLabelTh = $state('');
	let formLabelEn = $state('');
	let formCategory = $state<'operational' | 'controlled'>('operational');
	let formDescription = $state('');
	let formIsDefault = $state(false);
	let formTouched = $state(false);

	$effect(() => {
		if (open) {
			if (editingItem) {
				formCode = editingItem.code;
				formLabelTh = editingItem.label_th ?? '';
				formLabelEn = editingItem.label_en ?? '';
				formCategory = editingItem.category === 'controlled' ? 'controlled' : 'operational';
				formDescription = editingItem.description || '';
				formIsDefault = editingItem.is_default || false;
			} else {
				formCode = '';
				formLabelTh = '';
				formLabelEn = '';
				formCategory = 'operational';
				formDescription = '';
				formIsDefault = false;
			}
			formTouched = false;
		}
	});

	const normalizedCode = $derived(
		formCode
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, '_')
	);
	const isCodeValid = $derived(/^[a-z0-9_]+$/.test(normalizedCode));
	const isCodeDuplicate = $derived(
		existingItems.some(
			(i: MasterDataItem) => i.code === normalizedCode && i.code !== editingItem?.code
		)
	);
	const duplicateTh = $derived(
		findDuplicateLabel(existingItems, formLabelTh.trim(), 'label_th', editingItem?.code)
	);
	const duplicateEn = $derived(
		findDuplicateLabel(existingItems, formLabelEn.trim(), 'label_en', editingItem?.code)
	);

	const codeErrorMessage = $derived.by(() => {
		if (editingItem) return null;
		if (!formTouched) return null;
		if (!formCode.trim()) return 'กรุณาระบุรหัสทักษะ (Value/Key)';
		if (!isCodeValid)
			return 'รหัสทักษะต้องเป็นตัวอักษรภาษาอังกฤษตัวพิมพ์เล็ก ตัวเลข และ _ เท่านั้น (ห้ามมีเว้นวรรค)';
		if (isCodeDuplicate) return 'รหัสทักษะนี้มีอยู่แล้วในระบบ กรุณาใช้รหัสอื่น';
		return null;
	});

	const labelThErrorMessage = $derived.by(() => {
		if (!formTouched) return null;
		if (!formLabelTh.trim()) return 'กรุณาระบุชื่อภาษาไทย';
		if (duplicateTh) return 'ชื่อทักษะภาษาไทยนี้มีอยู่แล้วในระบบ';
		return null;
	});

	const labelEnErrorMessage = $derived.by(() => {
		if (!formTouched) return null;
		if (!formLabelEn.trim()) return 'กรุณาระบุชื่อภาษาอังกฤษ';
		if (duplicateEn) return 'ชื่อทักษะภาษาอังกฤษนี้มีอยู่แล้วในระบบ';
		return null;
	});

	const canSubmit = $derived(
		formCode.trim().length > 0 &&
			isCodeValid &&
			!isCodeDuplicate &&
			formLabelTh.trim().length > 0 &&
			formLabelEn.trim().length > 0 &&
			!duplicateTh &&
			!duplicateEn
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		formTouched = true;
		if (!canSubmit) return;

		await onSave({
			code: normalizedCode,
			label_th: formLabelTh.trim(),
			label_en: formLabelEn.trim(),
			category: formCategory,
			description: formDescription.trim(),
			is_default: formIsDefault
		});
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-xl animate-in overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl duration-150 zoom-in-95 fade-in"
		>
			<header class="mb-5 flex items-center justify-between border-b border-border pb-4">
				<div>
					<h2 class="flex items-center gap-2 text-lg font-bold text-foreground">
						{#if editingItem}
							<Pencil class="h-4 w-4 text-primary" /> แก้ไขทักษะมาตรฐาน
						{:else}
							<Plus class="h-4 w-4 text-primary" /> เพิ่มทักษะมาตรฐานใหม่
						{/if}
					</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						บันทึกการตั้งค่าทักษะลง CouchDB (registry master data)
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 cursor-pointer rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={onClose}
				>
					<X class="h-4 w-4" />
				</Button>
			</header>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div>
					<label for="formCode" class="mb-1.5 block text-xs font-bold text-foreground">
						รหัสทักษะ (Value / Key)
						{#if !editingItem}
							<span class="text-danger">* ห้ามมีเว้นวรรค</span>
						{:else}
							<span class="text-xs font-normal text-muted-foreground">(ไม่สามารถแก้ไขได้)</span>
						{/if}
					</label>
					<Input
						id="formCode"
						type="text"
						bind:value={formCode}
						disabled={!!editingItem}
						readonly={!!editingItem}
						placeholder="เช่น medical_first_aid, cooking_kitchen, logistics"
						class="w-full rounded-xl border-border bg-background px-4 py-2.5 font-mono text-xs focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-80 {codeErrorMessage
							? 'border-danger focus:border-danger focus:ring-danger'
							: ''}"
					/>
					{#if editingItem}
						<p class="mt-1 text-3xs text-muted-foreground">
							รหัสทักษะ (ID) เป็นค่าคงที่สำหรับอ้างอิงในระบบ ไม่สามารถแก้ไขได้
						</p>
					{:else if codeErrorMessage}
						<p class="mt-1 text-2xs font-medium text-danger">{codeErrorMessage}</p>
					{:else}
						<p class="mt-1 text-3xs text-muted-foreground">
							ใช้ตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข และ _ เท่านั้น (ห้ามมีเว้นวรรค)
						</p>
					{/if}
				</div>

				<div>
					<label for="formLabelTh" class="mb-1.5 block text-xs font-bold text-foreground">
						ชื่อแสดงผลภาษาไทย <span class="text-danger">*</span>
					</label>
					<Input
						id="formLabelTh"
						type="text"
						bind:value={formLabelTh}
						placeholder="เช่น การแพทย์ / ปฐมพยาบาล"
						class="w-full rounded-xl border-border bg-background px-4 py-2.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary {labelThErrorMessage
							? 'border-danger focus:border-danger focus:ring-danger'
							: ''}"
					/>
					{#if labelThErrorMessage}
						<p class="mt-1 text-2xs font-medium text-danger">{labelThErrorMessage}</p>
					{/if}
				</div>

				<div>
					<label for="formLabelEn" class="mb-1.5 block text-xs font-bold text-foreground">
						ชื่อแสดงผลภาษาอังกฤษ <span class="text-danger">*</span>
					</label>
					<Input
						id="formLabelEn"
						type="text"
						bind:value={formLabelEn}
						placeholder="e.g. Medical / first aid"
						class="w-full rounded-xl border-border bg-background px-4 py-2.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary {labelEnErrorMessage
							? 'border-danger focus:border-danger focus:ring-danger'
							: ''}"
					/>
					{#if labelEnErrorMessage}
						<p class="mt-1 text-2xs font-medium text-danger">{labelEnErrorMessage}</p>
					{/if}
				</div>

				<div>
					<span class="mb-2 block text-xs font-bold text-foreground">
						ประเภททักษะ (Skill Type / Category) <span class="text-danger">*</span>
					</span>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all {formCategory ===
							'operational'
								? 'border-success bg-success/10 text-foreground'
								: 'border-border bg-background text-muted-foreground hover:bg-muted/30'}"
						>
							<input
								type="radio"
								name="skillCategory"
								value="operational"
								bind:group={formCategory}
								class="mt-0.5 text-success focus:ring-success"
							/>
							<div>
								<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
									<Sparkles class="h-3.5 w-3.5 text-success" />
									ทักษะทั่วไป (Operational)
								</p>
								<p class="mt-0.5 text-3xs text-muted-foreground">
									ปฏิบัติหน้าที่ทั่วไป อนุมัติอัตโนมัติ (Auto-Approve) ได้
								</p>
							</div>
						</label>

						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all {formCategory ===
							'controlled'
								? 'border-warning bg-warning/10 text-foreground'
								: 'border-border bg-background text-muted-foreground hover:bg-muted/30'}"
						>
							<input
								type="radio"
								name="skillCategory"
								value="controlled"
								bind:group={formCategory}
								class="mt-0.5 text-warning focus:ring-warning"
							/>
							<div>
								<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
									<ShieldAlert class="h-3.5 w-3.5 text-warning" />
									ทักษะควบคุม (Controlled)
								</p>
								<p class="mt-0.5 text-3xs text-muted-foreground">
									วิชาชีพ/การแพทย์ ต้องมีใบประกอบวิชาชีพและรออนุมัติ
								</p>
							</div>
						</label>
					</div>
				</div>

				<div>
					<label for="formDescription" class="mb-1.5 block text-xs font-bold text-foreground">
						คำอธิบายขอบเขตหน้าที่ (Description)
					</label>
					<Textarea
						id="formDescription"
						rows={3}
						bind:value={formDescription}
						placeholder="ระบุรายละเอียดงาน ความรับผิดชอบ หรือคุณสมบัติที่จำเป็น..."
						class="w-full rounded-xl border-border bg-background p-3 text-xs focus:border-primary focus:ring-1 focus:ring-primary"
					/>
				</div>

				<div class="pt-2">
					<label class="flex cursor-pointer items-center gap-2.5">
						<input
							type="checkbox"
							bind:checked={formIsDefault}
							class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
						/>
						<span class="text-xs font-medium text-foreground">
							ตั้งเป็นทักษะค่าเริ่มต้น (Default Selection)
						</span>
					</label>
				</div>

				<div class="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
					<Button
						type="button"
						variant="outline"
						class="rounded-xl border-border bg-muted/30 px-4 py-2.5 text-xs font-bold text-foreground hover:bg-muted"
						onclick={onClose}
					>
						ยกเลิก
					</Button>
					<Button
						type="submit"
						disabled={!canSubmit || isPending}
						class="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-70"
					>
						<Check class="h-4 w-4" />
						{isPending ? 'กำลังบันทึกลง CouchDB...' : 'บันทึกทักษะ'}
					</Button>
				</div>
			</form>
		</div>
	</div>
{/if}

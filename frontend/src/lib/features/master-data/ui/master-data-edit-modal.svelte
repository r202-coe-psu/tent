<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		MASTER_DATA_TYPE_META,
		findDuplicateLabel,
		isLegacyItemCode,
		normalizeMasterCode,
		type MasterDataItem,
		type MasterDataType
	} from '$lib/features/master-data';

	export type MasterDataEditSubmit = {
		code: string;
		/** Present on edit when renaming a legacy `item_*` code. */
		newCode?: string;
		label_th: string;
		label_en: string;
		is_default: boolean;
		category?: 'operational' | 'controlled';
		description?: string;
	};

	let {
		open = $bindable(false),
		masterType,
		editing,
		existingItems = [],
		existingItemsReady = true,
		onSubmit
	}: {
		open: boolean;
		masterType: MasterDataType;
		editing: MasterDataItem | null;
		existingItems?: readonly MasterDataItem[];
		existingItemsReady?: boolean;
		onSubmit: (input: MasterDataEditSubmit) => void;
	} = $props();

	let code = $state('');
	let labelTh = $state('');
	let labelEn = $state('');
	let isDefault = $state(false);
	let category = $state<'operational' | 'controlled'>('operational');
	let description = $state('');
	let touched = $state(false);

	const isVolunteer = $derived(masterType === 'volunteer_skills');
	const isEdit = $derived(!!editing);
	const codeEditable = $derived(!isEdit || (editing ? isLegacyItemCode(editing.code) : false));
	const codeTrimmed = $derived(code.trim());
	const normalizedCode = $derived(normalizeMasterCode(codeTrimmed));
	const labelThTrimmed = $derived(labelTh.trim());
	const labelEnTrimmed = $derived(labelEn.trim());

	const duplicateTh = $derived(
		findDuplicateLabel(existingItems, labelThTrimmed, 'label_th', editing?.code)
	);
	const duplicateEn = $derived(
		findDuplicateLabel(existingItems, labelEnTrimmed, 'label_en', editing?.code)
	);
	const duplicateCode = $derived(
		normalizedCode &&
			existingItems.some((i) => i.code === normalizedCode && i.code !== editing?.code)
			? normalizedCode
			: null
	);

	const codeError = $derived(
		!codeEditable
			? null
			: touched && !codeTrimmed
				? 'กรุณากรอกรหัส (key)'
				: touched && !normalizedCode
					? 'รหัสต้องเป็น lower_snake (a-z, 0-9, _)'
					: duplicateCode
						? `มีรหัส "${duplicateCode}" อยู่แล้วในประเภทนี้`
						: null
	);
	const labelThError = $derived(
		touched && !labelThTrimmed
			? 'กรุณากรอกชื่อภาษาไทย'
			: duplicateTh
				? `มีรายการชื่อไทยนี้อยู่แล้ว${duplicateTh.status === 'inactive' ? ' (ปิดใช้แล้ว)' : ''}`
				: null
	);
	const labelEnError = $derived(
		touched && !labelEnTrimmed
			? 'กรุณากรอกชื่อภาษาอังกฤษ'
			: duplicateEn
				? `มีรายการชื่ออังกฤษนี้อยู่แล้ว${duplicateEn.status === 'inactive' ? ' (ปิดใช้แล้ว)' : ''}`
				: null
	);
	const listReadyError = $derived(
		!existingItemsReady ? 'ยังโหลดรายการเดิมไม่สำเร็จ — ตรวจสอบชื่อซ้ำไม่ได้ กรุณาลองใหม่' : null
	);
	const canSubmit = $derived(
		!!labelThTrimmed &&
			!!labelEnTrimmed &&
			!duplicateTh &&
			!duplicateEn &&
			!duplicateCode &&
			existingItemsReady &&
			(codeEditable ? !!normalizedCode : true)
	);

	$effect(() => {
		if (open) {
			code = editing?.code ?? '';
			labelTh = editing?.label_th ?? '';
			labelEn = editing?.label_en ?? '';
			isDefault = editing?.is_default ?? false;
			category =
				editing?.category === 'controlled' || editing?.category === 'CONTROLLED'
					? 'controlled'
					: 'operational';
			description = editing?.description ?? '';
			touched = false;
		}
	});

	function close() {
		open = false;
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		touched = true;
		if (!canSubmit) return;
		const submitCode = editing?.code ?? normalizedCode!;
		onSubmit({
			code: submitCode,
			...(editing && codeEditable && normalizedCode && normalizedCode !== editing.code
				? { newCode: normalizedCode }
				: {}),
			label_th: labelThTrimmed,
			label_en: labelEnTrimmed,
			is_default: isDefault,
			...(isVolunteer ? { category, description: description.trim() } : {})
		});
		close();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="master-data-modal-title"
	>
		<div class="w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white p-6 shadow-md">
			<header class="mb-4">
				<h2 id="master-data-modal-title" class="text-lg font-bold text-slate-900">
					{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'} · {MASTER_DATA_TYPE_META[masterType].shortTitle}
				</h2>
			</header>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="space-y-1.5">
					<Label for="master-data-code" class="text-sm font-semibold text-slate-700">
						รหัส (key) <span class="text-red-500">*</span>
					</Label>
					<Input
						id="master-data-code"
						bind:value={code}
						placeholder="เช่น chronic_illness"
						class="h-11 font-mono text-sm"
						readonly={!codeEditable}
						aria-invalid={codeError ? 'true' : 'false'}
						autocomplete="off"
					/>
					{#if codeError}
						<p class="text-xs text-red-600" role="alert">{codeError}</p>
					{:else if !codeEditable}
						<p class="text-xs text-slate-500">รหัสแบบ slug แก้ไขไม่ได้</p>
					{:else if isEdit}
						<p class="text-xs text-slate-500">
							รหัสเดิมเป็น item_* — สามารถเปลี่ยนเป็น slug ที่อ่านได้
						</p>
					{:else}
						<p class="text-xs text-slate-500">ใช้ตัวอักษรเล็ก ตัวเลข และ _ เท่านั้น</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<Label for="master-data-label-th" class="text-sm font-semibold text-slate-700">
						ชื่อ (ไทย) <span class="text-red-500">*</span>
					</Label>
					<Input
						id="master-data-label-th"
						bind:value={labelTh}
						placeholder="กรอกชื่อภาษาไทย"
						class="h-11"
						aria-invalid={labelThError ? 'true' : 'false'}
						autocomplete="off"
					/>
					{#if labelThError}
						<p class="text-xs text-red-600" role="alert">{labelThError}</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<Label for="master-data-label-en" class="text-sm font-semibold text-slate-700">
						ชื่อ (English) <span class="text-red-500">*</span>
					</Label>
					<Input
						id="master-data-label-en"
						bind:value={labelEn}
						placeholder="Enter English label"
						class="h-11"
						aria-invalid={labelEnError ? 'true' : 'false'}
						autocomplete="off"
					/>
					{#if labelEnError}
						<p class="text-xs text-red-600" role="alert">{labelEnError}</p>
					{/if}
				</div>

				{#if listReadyError}
					<p class="text-xs text-red-600" role="alert">{listReadyError}</p>
				{/if}

				{#if isVolunteer}
					<div class="space-y-1.5">
						<span class="text-sm font-semibold text-slate-700" id="master-data-category-label">
							หมวดหมู่ <span class="text-red-500">*</span>
						</span>
						<div
							class="grid grid-cols-2 gap-2"
							role="group"
							aria-labelledby="master-data-category-label"
						>
							<button
								type="button"
								class="min-h-11 rounded-lg border px-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
									{category === 'operational'
									? 'border-sky-200 bg-sky-50 text-sky-900'
									: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
								aria-pressed={category === 'operational'}
								onclick={() => (category = 'operational')}
							>
								ภาคสนาม
							</button>
							<button
								type="button"
								class="min-h-11 rounded-lg border px-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
									{category === 'controlled'
									? 'border-sky-200 bg-sky-50 text-sky-900'
									: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
								aria-pressed={category === 'controlled'}
								onclick={() => (category = 'controlled')}
							>
								ควบคุมพิเศษ
							</button>
						</div>
					</div>

					<div class="space-y-1.5">
						<Label for="master-data-description" class="text-sm font-semibold text-slate-700">
							คำอธิบาย
						</Label>
						<Textarea
							id="master-data-description"
							bind:value={description}
							placeholder="คำอธิบายสั้นๆ (ไม่บังคับ)"
							rows={3}
							class="min-h-[88px] resize-y"
						/>
					</div>
				{/if}

				<div class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
					<Checkbox
						bind:checked={isDefault}
						class="mt-0.5"
						aria-labelledby="master-data-default-label"
					/>
					<div class="flex-1">
						<div
							id="master-data-default-label"
							class="text-sm leading-none font-medium text-slate-800"
						>
							ตั้งเป็นค่าเริ่มต้น
						</div>
						<p class="mt-1 text-xs text-slate-500">
							เมื่อเลือก ตัวเลือกนี้จะถูกตั้งเป็นค่าเริ่มต้นในฟอร์มที่เกี่ยวข้อง
						</p>
					</div>
				</div>

				<footer class="mt-6 flex items-center justify-end gap-2">
					<Button type="button" variant="outline" class="min-h-11" onclick={close}>ยกเลิก</Button>
					<Button
						type="submit"
						disabled={!canSubmit}
						class="min-h-11 bg-[#0A2647] text-white hover:bg-[#051930]"
					>
						บันทึก
					</Button>
				</footer>
			</form>
		</div>
	</div>
{/if}

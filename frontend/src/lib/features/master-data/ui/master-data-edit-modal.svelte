<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		MASTER_DATA_TYPE_LABELS,
		findDuplicateLabel,
		type MasterDataItem,
		type MasterDataType
	} from '$lib/features/master-data';

	let {
		open = $bindable(false),
		masterType,
		editing,
		existingItems = [],
		onSubmit
	}: {
		open: boolean;
		masterType: MasterDataType;
		editing: MasterDataItem | null;
		/** Every item already shown for this type — under a shelter that is the
		 *  merged global + shelter-local list, so the check covers both (CR-078). */
		existingItems?: readonly MasterDataItem[];
		onSubmit: (input: { code?: string; label: string; is_default: boolean }) => void;
	} = $props();

	let label = $state('');
	let isDefault = $state(false);
	let touched = $state(false);

	const labelTrimmed = $derived(label.trim());
	// Labels are unique per master type (CR-078). Excluding the item being edited
	// keeps a re-save without a rename legal. The server re-checks on PUT.
	const duplicate = $derived(findDuplicateLabel(existingItems, labelTrimmed, editing?.code));
	const labelError = $derived(
		touched && !labelTrimmed
			? 'กรุณากรอกชื่อแสดงผลภาษาไทย'
			: duplicate
				? `มีรายการชื่อนี้อยู่แล้วในประเภทนี้${duplicate.status === 'inactive' ? ' (ปิดใช้งานอยู่)' : ''}`
				: null
	);

	$effect(() => {
		if (open) {
			label = editing?.label ?? '';
			isDefault = editing?.is_default ?? false;
			touched = false;
		}
	});

	function close() {
		open = false;
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		touched = true;
		if (!labelTrimmed || duplicate) return;
		onSubmit({ code: editing?.code, label: labelTrimmed, is_default: isDefault });
		close();
	}
</script>

{#if open}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="master-data-modal-title"
	>
		<div class="w-full max-w-2xl rounded-xl bg-card p-6 shadow-xl">
			<header class="mb-4">
				<h2 id="master-data-modal-title" class="mt-1 flex items-center gap-2 text-lg font-semibold">
					{editing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}
					{MASTER_DATA_TYPE_LABELS[masterType]}
				</h2>
			</header>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="space-y-2">
					<Label for="master-data-label">
						Label (ชื่อแสดงผลภาษาไทย) <span class="text-destructive">*</span>
					</Label>
					<Input
						id="master-data-label"
						bind:value={label}
						placeholder="กรอกชื่อแสดงผลภาษาไทย"
						aria-invalid={labelError ? 'true' : 'false'}
						autocomplete="off"
					/>
					{#if labelError}
						<p class="text-xs text-destructive" role="alert">{labelError}</p>
					{/if}
				</div>

				<!-- Not a <label>: shadcn Checkbox renders a <button role="checkbox">,
				     and nesting a button inside a <label> is invalid HTML. Associate
				     the text via aria-labelledby instead. -->
				<div class="flex items-start gap-3 rounded-md border border-input bg-background p-3">
					<Checkbox
						bind:checked={isDefault}
						class="mt-0.5"
						aria-labelledby="master-data-default-label"
					/>
					<div class="flex-1">
						<div id="master-data-default-label" class="text-sm leading-none font-medium">
							ตั้งค่าเป็นค่าเริ่มต้นสำหรับประเภทนี้ (Set as Default Option)
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							เมื่อเลือก
							ตัวเลือกนี้จะถูกตั้งเป็นตัวเลือกเริ่มต้นอัตโนมัติในการลงทะเบียนหรือเรียกใช้งานของหัววัยนี้
						</p>
					</div>
				</div>

				<footer class="mt-6 flex items-center justify-end gap-2">
					<Button type="button" variant="outline" onclick={close}>ยกเลิกและย้อนกลับ</Button>
					<Button type="submit" disabled={!labelTrimmed || !!duplicate}>
						<svg
							class="mr-1.5 h-4 w-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
							<polyline points="17 21 17 13 7 13 7 21" />
							<polyline points="7 3 7 8 15 8" />
						</svg>
						บันทึก
					</Button>
				</footer>
			</form>
		</div>
	</div>
{/if}

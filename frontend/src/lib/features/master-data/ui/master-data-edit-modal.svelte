<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		MASTER_DATA_TYPE_LABELS,
		type MasterDataItem,
		type MasterDataType
	} from '$lib/features/master-data';

	let {
		open = $bindable(false),
		masterType,
		editing,
		onSubmit
	}: {
		open: boolean;
		masterType: MasterDataType;
		editing: MasterDataItem | null;
		onSubmit: (input: { code?: string; label: string; is_default: boolean }) => void;
	} = $props();

	let label = $state('');
	let isDefault = $state(false);
	let touched = $state(false);

	const labelTrimmed = $derived(label.trim());
	const labelError = $derived(touched && !labelTrimmed ? 'กรุณากรอกชื่อแสดงผลภาษาไทย' : null);

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
		if (!labelTrimmed) return;
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
				<div class="text-xs font-medium text-muted-foreground">
					ฐานข้อมูลมาสเตอร์ล่วงกลาง (MASTER DATA ENGINE)
				</div>
				<h2 id="master-data-modal-title" class="mt-1 flex items-center gap-2 text-lg font-semibold">
					<span aria-hidden="true">🛠️</span>
					{editing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}พารามิเตอร์มาตรฐาน / สูตรเสมือน
				</h2>
			</header>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="space-y-2">
					<Label for="master-data-type">หมวดหมู่ข้อมูล (Type)</Label>
					<div
						id="master-data-type"
						class="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
					>
						{MASTER_DATA_TYPE_LABELS[masterType]}
					</div>
				</div>

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

				<label
					class="flex cursor-pointer items-start gap-3 rounded-md border border-input bg-background p-3 transition hover:bg-accent"
				>
					<Checkbox bind:checked={isDefault} class="mt-0.5" />
					<div class="flex-1">
						<div class="text-sm leading-none font-medium">
							ตั้งค่าเป็นค่าเริ่มต้นสำหรับประเภทนี้ (Set as Default Option)
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							เมื่อเลือก
							ตัวเลือกนี้จะถูกตั้งเป็นตัวเลือกเริ่มต้นอัตโนมัติในการลงทะเบียนหรือเรียกใช้งานของหัววัยนี้
						</p>
					</div>
				</label>

				<footer class="mt-6 flex items-center justify-end gap-2">
					<Button type="button" variant="outline" onclick={close}>ยกเลิกและย้อนกลับ</Button>
					<Button type="submit">
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

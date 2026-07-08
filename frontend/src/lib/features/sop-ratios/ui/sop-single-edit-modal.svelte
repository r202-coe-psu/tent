<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		isSopMaster,
		type SopMaster,
		type SopOverride,
		type SopRatioKey,
		RATIO_LABELS,
		useCreateMasterVersion,
		useCreateOverrideVersion
	} from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';

	let {
		open = $bindable(false),
		profile,
		ratioKey,
		onClose
	}: {
		open: boolean;
		profile: SopMaster | SopOverride;
		ratioKey: SopRatioKey | null;
		onClose: () => void;
	} = $props();

	const isMaster = $derived(profile ? isSopMaster(profile) : false);

	const masterMutation = useCreateMasterVersion();
	const overrideMutation = useCreateOverrideVersion(() =>
		isMaster ? '' : (profile as SopOverride)?.shelter_code
	);

	const isSaving = $derived(masterMutation.isPending || overrideMutation.isPending);

	let value = $state(0);
	let reason = $state('');
	let touched = $state(false);

	const meta = $derived(ratioKey ? RATIO_LABELS[ratioKey] : null);
	const valueError = $derived(
		touched && (Number(value) <= 0 || isNaN(Number(value))) ? 'กรุณากรอกค่ากำหนดที่มากกว่า 0' : null
	);
	const reasonError = $derived(touched && !reason.trim() ? 'กรุณากรอกเหตุผลในการแก้ไข' : null);

	$effect(() => {
		if (open && profile && ratioKey) {
			value = profile.ratios[ratioKey] ?? 0;
			reason = '';
			touched = false;
		}
	});

	function close() {
		open = false;
		onClose();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		console.log('[SOP Modal] Submit clicked! Current value:', value, 'Reason:', reason);
		touched = true;

		if (valueError || reasonError || !ratioKey) {
			console.warn('[SOP Modal] Validation blocked submit!', { valueError, reasonError, ratioKey });
			return;
		}

		const changes = { [ratioKey]: Number(value) };
		console.log('[SOP Modal] Submitting mutation...', { isMaster, changes });

		try {
			if (isMaster) {
				await masterMutation.mutateAsync({
					prev: profile as SopMaster,
					changes,
					reason: reason.trim(),
					createdBy: authStore.user?.name ?? 'unknown'
				});
			} else {
				const override = profile as SopOverride;
				await overrideMutation.mutateAsync({
					prev: override,
					changes,
					reason: reason.trim(),
					ctx: {
						shelterCode: override.shelter_code,
						createdBy: authStore.user?.name ?? 'unknown'
					}
				});
			}
			close();
		} catch (err) {
			console.error('Failed to save SOP single ratio:', err);
		}
	}
</script>

{#if open && ratioKey && meta}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="sop-modal-title"
	>
		<div class="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-xl">
			<header class="mb-4">
				<div class="text-xs font-medium text-muted-foreground">
					ฐานข้อมูลมาสเตอร์ล่วงกลาง (MASTER DATA ENGINE)
				</div>
				<h2 id="sop-modal-title" class="mt-1 flex items-center gap-2 text-lg font-semibold">
					<span aria-hidden="true">🛠️</span>
					แก้ไขพารามิเตอร์มาตรฐาน / สูตรเสมือน
				</h2>
			</header>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="space-y-2">
					<Label for="sop-item-name">หมวดหมู่ข้อมูล (Type)</Label>
					<div
						id="sop-item-name"
						class="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
					>
						ตัวคูณมาตรฐานดำรงชีพ (Sphere Standard)
					</div>
				</div>

				<div class="space-y-2">
					<Label>รายการพารามิเตอร์ (Item)</Label>
					<div class="rounded-md border bg-background px-3 py-2 text-sm font-medium">
						{meta.label}
						{#if meta.description}
							<div class="mt-0.5 text-xs font-normal text-muted-foreground">{meta.description}</div>
						{/if}
					</div>
				</div>

				<div class="space-y-2">
					<Label for="sop-value">
						ค่ากำหนด (Value) <span class="text-destructive">*</span>
					</Label>
					<div class="flex items-center gap-2">
						<Input
							id="sop-value"
							type="number"
							step="0.001"
							min="0.001"
							bind:value
							class="font-mono"
							aria-invalid={valueError ? 'true' : 'false'}
						/>
						<span
							class="rounded-md border bg-muted px-3 py-2 text-sm font-semibold whitespace-nowrap text-muted-foreground"
						>
							{meta.unit}
						</span>
					</div>
					{#if valueError}
						<p class="text-xs text-destructive" role="alert">{valueError}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="sop-reason">
						เหตุผลในการแก้ไข <span class="text-destructive">*</span>
					</Label>
					<Textarea
						id="sop-reason"
						bind:value={reason}
						placeholder="กรุณาระบุเหตุผล เช่น ปรับปรุงปริมาณการแจกจ่ายตามสภาพพื้นที่..."
						aria-invalid={reasonError ? 'true' : 'false'}
					/>
					{#if reasonError}
						<p class="text-xs text-destructive" role="alert">{reasonError}</p>
					{/if}
				</div>

				<footer class="mt-6 flex items-center justify-end gap-2">
					<Button type="button" variant="outline" onclick={close}>ยกเลิกและย้อนกลับ</Button>
					<div title={!reason.trim() ? 'กรุณากรอกเหตุผลในการแก้ไขเพื่อปลดล็อกปุ่ม' : ''}>
						<Button type="submit" disabled={isSaving || !reason.trim() || Number(value) <= 0}>
							{#if isSaving}
								กำลังบันทึก...
							{:else}
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
								บันทึกเวอร์ชันใหม่
							{/if}
						</Button>
					</div>
				</footer>
			</form>
		</div>
	</div>
{/if}

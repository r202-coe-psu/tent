<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import Eye from '@lucide/svelte/icons/eye';
	import { KIOSK_BANNER_LIMITS } from '../domain/kiosk-banner';
	import {
		bannerFormToInput,
		bannerToFormValues,
		emptyKioskBannerForm,
		kioskBannerFormSchema
	} from '../domain/kiosk-banner-form';
	import {
		readBannerFile,
		validateBannerFile,
		type BannerImagePayload
	} from '../data/kiosk-banner-file';
	import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
	import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
	import KioskBannerPreviewDialog from './kiosk-banner-preview-dialog.svelte';
	import { buildFormPreviewSlide } from './kiosk-banner-preview-slides';
	import type { KioskBannerSavePayload } from './kiosk-banner-save';

	/**
	 * Create / edit form for one banner (FR-KBR-26, FR-KBN-21/28). The shelter is the active one and
	 * cannot be changed. `onsave` receives the API input plus the image (omitted on edit when no new
	 * file was chosen) and handles its own errors.
	 */
	let {
		shelterCode,
		banner,
		onsave
	}: {
		shelterCode: string;
		/** Present in edit mode. */
		banner?: KioskBannerSummary;
		onsave: (payload: KioskBannerSavePayload) => Promise<void>;
	} = $props();

	// The form is mounted per banner; later prop changes must not overwrite what the user typed.
	// svelte-ignore state_referenced_locally
	const isEdit = banner !== undefined;
	// svelte-ignore state_referenced_locally
	const initialRev = banner?._rev;
	// svelte-ignore state_referenced_locally
	const initialValues = banner ? bannerToFormValues(banner) : emptyKioskBannerForm();
	// svelte-ignore state_referenced_locally
	const currentImageUrl = banner
		? kioskBannerRemoteRepository.imageUrl(banner._id, banner._rev)
		: null;

	let file = $state.raw<File | null>(null);
	let fileError = $state<string | null>(null);
	let newImageUrl = $state<string | null>(null);
	let previewOpen = $state(false);

	function revokeNewImage() {
		if (newImageUrl) URL.revokeObjectURL(newImageUrl);
		newImageUrl = null;
	}

	// Unmount only (no reactive reads here): free the last preview.
	$effect(() => () => {
		if (newImageUrl) URL.revokeObjectURL(newImageUrl);
	});

	function handleFileChange(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const chosen = input.files?.[0] ?? null;
		revokeNewImage();
		file = null;
		fileError = null;
		if (!chosen) return;
		const problem = validateBannerFile(chosen);
		if (problem) {
			fileError = problem;
			input.value = '';
			return;
		}
		file = chosen;
		newImageUrl = URL.createObjectURL(chosen);
	}

	const form = superForm(defaults(initialValues, zod4Client(kioskBannerFormSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4Client(kioskBannerFormSchema),
		resetForm: false,
		// Nothing to apply to a page: SPA forms update their own stores (no router round trip).
		applyAction: false,
		warnings: { duplicateId: false },
		onUpdate: async ({ form: validated }) => {
			const imageMissing = !isEdit && !file;
			if (imageMissing) fileError = 'เลือกรูปภาพแบนเนอร์';
			if (!validated.valid || imageMissing || fileError) return;
			let image: BannerImagePayload | undefined;
			try {
				image = file ? await readBannerFile(file) : undefined;
			} catch {
				toast.error('อ่านไฟล์รูปภาพไม่สำเร็จ');
				return;
			}
			await onsave({ input: bannerFormToInput(validated.data), image, rev: initialRev });
		}
	});

	const { form: formData, errors, enhance, submitting } = form;

	const previewSlides = $derived.by(() => {
		const slide = buildFormPreviewSlide($formData, newImageUrl ?? currentImageUrl);
		return slide ? [slide] : [];
	});

	const listHref = resolve('/back-office/kiosks/banners');
</script>

<form method="post" use:enhance novalidate class="space-y-6">
	<div class="grid gap-6 lg:grid-cols-2">
		<Field.Group class="gap-4">
			<Field.Field>
				<Field.Label>ศูนย์</Field.Label>
				<p class="flex min-h-9 items-center text-sm font-semibold text-slate-900">
					{shelterCode}
					<span class="ml-2 text-xs font-normal text-slate-500"
						>(แก้ไขไม่ได้ — ตามศูนย์ที่เลือกอยู่)</span
					>
				</p>
			</Field.Field>

			<Field.Field data-invalid={$errors.title ? true : undefined}>
				<Field.Label for="banner-title">ชื่อ *</Field.Label>
				<Input
					id="banner-title"
					class="h-11"
					maxlength={KIOSK_BANNER_LIMITS.titleMax}
					aria-invalid={$errors.title ? true : undefined}
					bind:value={$formData.title}
				/>
				{#if $errors.title}<Field.Error>{$errors.title[0]}</Field.Error>{/if}
			</Field.Field>

			<Field.Field data-invalid={$errors.caption ? true : undefined}>
				<Field.Label for="banner-caption">คำบรรยาย</Field.Label>
				<Textarea
					id="banner-caption"
					rows={2}
					maxlength={KIOSK_BANNER_LIMITS.captionMax}
					aria-invalid={$errors.caption ? true : undefined}
					bind:value={$formData.caption}
				/>
				{#if $errors.caption}<Field.Error>{$errors.caption[0]}</Field.Error>{/if}
			</Field.Field>

			<div class="grid grid-cols-2 gap-4">
				<Field.Field data-invalid={$errors.order ? true : undefined}>
					<Field.Label for="banner-order">ลำดับ *</Field.Label>
					<Input
						id="banner-order"
						type="number"
						min={KIOSK_BANNER_LIMITS.orderMin}
						step="1"
						class="h-11"
						aria-invalid={$errors.order ? true : undefined}
						bind:value={$formData.order}
					/>
					{#if $errors.order}<Field.Error>{$errors.order[0]}</Field.Error>{/if}
				</Field.Field>
				<Field.Field data-invalid={$errors.duration_sec ? true : undefined}>
					<Field.Label for="banner-duration_sec">วินาที/สไลด์ *</Field.Label>
					<Input
						id="banner-duration_sec"
						type="number"
						min={KIOSK_BANNER_LIMITS.durationMin}
						max={KIOSK_BANNER_LIMITS.durationMax}
						step="1"
						class="h-11"
						aria-invalid={$errors.duration_sec ? true : undefined}
						bind:value={$formData.duration_sec}
					/>
					{#if $errors.duration_sec}<Field.Error>{$errors.duration_sec[0]}</Field.Error>{/if}
				</Field.Field>
			</div>

			<Field.Field data-invalid={$errors.start_at ? true : undefined}>
				<Field.Label for="banner-start_at">เริ่ม * (เวลาไทย)</Field.Label>
				<Input
					id="banner-start_at"
					type="datetime-local"
					class="h-11"
					aria-invalid={$errors.start_at ? true : undefined}
					bind:value={$formData.start_at}
				/>
				{#if $errors.start_at}<Field.Error>{$errors.start_at[0]}</Field.Error>{/if}
			</Field.Field>

			<Field.Field data-invalid={$errors.end_at ? true : undefined}>
				<Field.Label for="banner-end_at">สิ้นสุด * (เวลาไทย)</Field.Label>
				<Input
					id="banner-end_at"
					type="datetime-local"
					class="h-11"
					aria-invalid={$errors.end_at ? true : undefined}
					aria-describedby={$errors.end_at ? 'banner-end_at-error' : undefined}
					bind:value={$formData.end_at}
				/>
				{#if $errors.end_at}
					<Field.Error id="banner-end_at-error">{$errors.end_at[0]}</Field.Error>
				{/if}
			</Field.Field>

			<div class="flex min-h-11 items-center gap-2">
				<Switch
					id="banner-status"
					bind:checked={
						() => $formData.status === 'active',
						(next) => ($formData.status = next ? 'active' : 'inactive')
					}
				/>
				<label for="banner-status" class="text-sm font-medium text-slate-700">
					{$formData.status === 'active' ? 'แสดงบนตู้' : 'ไม่แสดง'}
				</label>
			</div>
		</Field.Group>

		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				{#if currentImageUrl}
					<figure class="space-y-2">
						<figcaption class="text-sm font-semibold text-slate-700">รูปปัจจุบัน</figcaption>
						<img
							data-testid="banner-current-image"
							src={currentImageUrl}
							alt="รูปปัจจุบันของแบนเนอร์"
							class="aspect-video w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
						/>
					</figure>
				{/if}
				<figure class="space-y-2">
					<figcaption class="text-sm font-semibold text-slate-700">
						{isEdit ? 'รูปใหม่ (ถ้าเลือก)' : 'ตัวอย่างรูป'}
					</figcaption>
					{#if newImageUrl}
						<img
							data-testid="banner-new-image"
							src={newImageUrl}
							alt="ตัวอย่างรูปที่เลือก"
							class="aspect-video w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
						/>
					{:else}
						<div
							class="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500"
						>
							ยังไม่ได้เลือกรูป
						</div>
					{/if}
				</figure>
			</div>

			<Field.Field data-invalid={fileError ? true : undefined}>
				<Field.Label for="banner-image">{isEdit ? 'เปลี่ยนรูป' : 'รูปแบนเนอร์ *'}</Field.Label>
				<Input
					id="banner-image"
					type="file"
					accept="image/png,image/jpeg,image/webp"
					class="h-11"
					aria-invalid={fileError ? true : undefined}
					aria-describedby="banner-image-help"
					onchange={handleFileChange}
				/>
				<Field.Description id="banner-image-help">
					รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB
				</Field.Description>
				{#if fileError}<Field.Error>{fileError}</Field.Error>{/if}
			</Field.Field>
		</div>
	</div>

	<div
		class="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<Button
			type="button"
			variant="outline"
			class="min-h-11 gap-2"
			onclick={() => (previewOpen = true)}
		>
			<Eye class="h-4 w-4" />
			ดูตัวอย่างบน kiosk
		</Button>
		<div class="flex flex-col gap-2 sm:flex-row">
			<Button variant="outline" class="min-h-11" href={listHref}>ยกเลิก</Button>
			<Button type="submit" class="btn-primary-brand min-h-11" disabled={$submitting}>
				{$submitting ? 'กำลังบันทึก…' : 'บันทึก'}
			</Button>
		</div>
	</div>
</form>

<KioskBannerPreviewDialog
	bind:open={previewOpen}
	slides={previewSlides}
	emptyMessage="เลือกรูปก่อนจึงจะดูตัวอย่างได้"
/>

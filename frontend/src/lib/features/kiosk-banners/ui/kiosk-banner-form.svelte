<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import TimePicker from '$lib/components/time-picker.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import Eye from '@lucide/svelte/icons/eye';
	import Upload from '@lucide/svelte/icons/upload';
	import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import KioskScreenPicker from '$lib/features/shared/ui/kiosk-screen-picker.svelte';
	import { KIOSK_BANNER_LIMITS } from '../domain/kiosk-banner';
	import { joinLocalInput, splitLocalInput } from '../domain/kiosk-banner-datetime';
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
	import type { KioskBannerSlide } from '$lib/features/kiosk';
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
		defaultScreen,
		groups,
		defaultGroupId,
		onsave
	}: {
		shelterCode: string;
		/** Present in edit mode. */
		banner?: KioskBannerSummary;
		/** Create mode only: the screen type the form starts on. */
		defaultScreen?: KioskScreenType;
		/** Banner groups of the active shelter the banner can belong to. */
		groups: { _id: string; name: string }[];
		/** Create mode only: the group the form starts on (the page's `?group=`). */
		defaultGroupId?: string;
		onsave: (payload: KioskBannerSavePayload) => Promise<void>;
	} = $props();

	// The form is mounted per banner; later prop changes must not overwrite what the user typed.
	// svelte-ignore state_referenced_locally
	const isEdit = banner !== undefined;
	// svelte-ignore state_referenced_locally
	const initialRev = banner?._rev;
	// svelte-ignore state_referenced_locally
	const initialValues = banner
		? bannerToFormValues(banner)
		: {
				...emptyKioskBannerForm(),
				...(defaultScreen ? { screen_type: defaultScreen } : {}),
				...(defaultGroupId ? { group_id: defaultGroupId } : {})
			};
	const isUngrouped = isEdit && initialValues.group_id === '';
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

	/** One path for the file picker and a drop: validate, then show the preview at once. */
	function chooseFile(chosen: File | null): boolean {
		revokeNewImage();
		file = null;
		fileError = null;
		if (!chosen) return true;
		const problem = validateBannerFile(chosen);
		if (problem) {
			fileError = problem;
			return false;
		}
		file = chosen;
		newImageUrl = URL.createObjectURL(chosen);
		return true;
	}

	function handleFileChange(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		if (!chooseFile(input.files?.[0] ?? null)) input.value = '';
	}

	let dragOver = $state(false);

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dragOver = true;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		const dropped = event.dataTransfer?.files?.[0];
		if (dropped) chooseFile(dropped);
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

	const { form: formData, enhance, submitting } = form;

	const imageHelp = $derived(
		`แนะนำ ${KIOSK_SCREENS[$formData.screen_type].size} px · รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB`
	);
	const selectedGroupName = $derived(groups.find((g) => g._id === $formData.group_id)?.name);
	const isPortrait = $derived($formData.screen_type === 'portrait');
	const imageShape = $derived(isPortrait ? 'aspect-[9/16] max-h-80 mx-auto' : 'aspect-video');

	const previewSlides = $derived.by(() => {
		const slide = buildFormPreviewSlide($formData, newImageUrl ?? currentImageUrl);
		const slides: Record<KioskScreenType, KioskBannerSlide[]> = { compact: [], portrait: [] };
		if (slide) slides[$formData.screen_type].push(slide);
		return slides;
	});

	const listHref = resolve('/back-office/kiosks/banners');
	const newGroupHref = resolve('/back-office/kiosks/banners/groups/new');
</script>

{#snippet dateTimeField(name: 'start_at' | 'end_at', label: string, errorsId?: string)}
	{@const parts = splitLocalInput($formData[name])}
	<Form.Field {form} {name}>
		<Form.Control id="banner-{name}">
			{#snippet children({ props })}
				<Form.Label>
					{label} <span class="text-destructive">*</span>
					<span class="font-normal text-slate-500">(เวลาไทย)</span>
				</Form.Label>
				<div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
					<DatePicker
						{...props}
						class="h-11"
						ariaLabel="วันที่{label}"
						bind:value={
							() => parts.date, (date) => ($formData[name] = joinLocalInput(date, parts.time))
						}
					/>
					<TimePicker
						id="banner-{name}-time"
						bind:value={
							() => parts.time, (time) => ($formData[name] = joinLocalInput(parts.date, time))
						}
					/>
					<Label for="banner-{name}-time" class="sr-only">เวลา{label}</Label>
				</div>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors id={errorsId} />
	</Form.Field>
{/snippet}

<form method="post" use:enhance novalidate class="space-y-6">
	<div class="grid gap-6 lg:grid-cols-2">
		<div class="space-y-4">
			<div class="space-y-2">
				<span class="text-sm font-medium">ศูนย์</span>
				<p class="flex min-h-9 items-center text-sm font-semibold text-slate-900">
					{shelterCode}
					<span class="ml-2 text-xs font-normal text-slate-500"
						>(แก้ไขไม่ได้ — ตามศูนย์ที่เลือกอยู่)</span
					>
				</p>
			</div>

			<Form.Field {form} name="group_id" class="space-y-2">
				<Form.Control id="banner-group_id">
					{#snippet children({ props })}
						<Form.Label>กลุ่มแบนเนอร์ <span class="text-destructive">*</span></Form.Label>
						<Select.Root
							type="single"
							bind:value={$formData.group_id}
							disabled={groups.length === 0}
						>
							<Select.Trigger {...props} class="h-11 w-full bg-white">
								{selectedGroupName ?? '— เลือกกลุ่ม —'}
							</Select.Trigger>
							<Select.Content>
								{#each groups as group (group._id)}
									<Select.Item value={group._id} label={group.name} />
								{/each}
							</Select.Content>
						</Select.Root>
					{/snippet}
				</Form.Control>
				{#if groups.length === 0}
					<p class="text-sm text-slate-700">
						ยังไม่มีกลุ่มแบนเนอร์ — สร้างกลุ่มก่อน
						<a href={newGroupHref} class="font-medium text-primary underline underline-offset-2">
							สร้างกลุ่มแบนเนอร์
						</a>
					</p>
				{:else if isUngrouped}
					<p class="text-sm text-amber-700">แบนเนอร์นี้ยังไม่อยู่ในกลุ่ม เลือกกลุ่มก่อนบันทึก</p>
				{/if}
				<Form.Description class="text-xs text-slate-500">
					แบนเนอร์จะแสดงเฉพาะเครื่องที่อยู่ในกลุ่มนี้ และขนาดจอตรงกัน
				</Form.Description>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="screen_type" class="space-y-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ขนาดหน้าจอ <span class="text-destructive">*</span></Form.Label>
						<KioskScreenPicker
							{...props}
							id="banner-screen_type"
							bind:value={$formData.screen_type}
						/>
					{/snippet}
				</Form.Control>
				<Form.Description class="text-xs text-slate-500">
					แบนเนอร์จะแสดงเฉพาะตู้ที่ตั้งขนาดหน้าจอตรงกัน
				</Form.Description>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="title">
				<Form.Control id="banner-title">
					{#snippet children({ props })}
						<Form.Label>ชื่อ <span class="text-destructive">*</span></Form.Label>
						<Input
							{...props}
							class="h-11"
							maxlength={KIOSK_BANNER_LIMITS.titleMax}
							bind:value={$formData.title}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="caption">
				<Form.Control id="banner-caption">
					{#snippet children({ props })}
						<Form.Label>คำบรรยาย</Form.Label>
						<Textarea
							{...props}
							rows={2}
							maxlength={KIOSK_BANNER_LIMITS.captionMax}
							bind:value={$formData.caption}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="duration_sec">
				<Form.Control id="banner-duration_sec">
					{#snippet children({ props })}
						<Form.Label>วินาที/สไลด์ <span class="text-destructive">*</span></Form.Label>
						<Input
							{...props}
							type="number"
							min={KIOSK_BANNER_LIMITS.durationMin}
							max={KIOSK_BANNER_LIMITS.durationMax}
							step="1"
							class="h-11"
							bind:value={$formData.duration_sec}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			{@render dateTimeField('start_at', 'เริ่ม')}

			{@render dateTimeField('end_at', 'สิ้นสุด', 'banner-end_at-error')}

			<Form.Field {form} name="status">
				<Form.Control id="banner-status">
					{#snippet children({ props })}
						<div class="flex min-h-11 items-center gap-2">
							<Switch
								{...props}
								bind:checked={
									() => $formData.status === 'active',
									(next) => ($formData.status = next ? 'active' : 'inactive')
								}
							/>
							<Form.Label class="text-slate-700">
								{$formData.status === 'active' ? 'แสดงบนตู้' : 'ไม่แสดง'}
							</Form.Label>
						</div>
					{/snippet}
				</Form.Control>
			</Form.Field>
		</div>

		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				{#if currentImageUrl}
					<figure class="space-y-2">
						<figcaption class="text-sm font-semibold text-slate-700">รูปปัจจุบัน</figcaption>
						<img
							data-testid="banner-current-image"
							src={currentImageUrl}
							alt="รูปปัจจุบันของแบนเนอร์"
							class="{imageShape} w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
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
							class="{imageShape} w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
						/>
					{:else}
						<div
							class="flex {imageShape} w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-400 bg-slate-50 text-sm text-slate-500"
						>
							ยังไม่ได้เลือกรูป
						</div>
					{/if}
				</figure>
			</div>

			<!-- The image is not in the superform schema (text fields only), so it is wired by hand.
			     Same dashed drop box as the Excel imports (people-import / shelter-import), plus drop. -->
			<div class="space-y-2">
				<span class={['text-sm font-medium', fileError && 'text-destructive']}>
					{#if isEdit}เปลี่ยนรูป{:else}รูปแบนเนอร์ <span class="text-destructive">*</span>{/if}
				</span>
				<label
					for="banner-image"
					ondragover={handleDragOver}
					ondragleave={() => (dragOver = false)}
					ondrop={handleDrop}
					class={[
						'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:bg-muted/40',
						dragOver
							? 'border-primary bg-primary/5'
							: fileError
								? 'border-destructive'
								: 'border-slate-400 hover:border-slate-500'
					]}
				>
					<Upload class="h-8 w-8 text-muted-foreground" />
					<span class="text-sm font-medium">
						{file ? file.name : 'ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์'}
					</span>
					<span id="banner-image-help" class="text-xs text-muted-foreground">
						{imageHelp}
					</span>
					<!-- sr-only, not `hidden`: display:none drops the input out of the tab
					     order, leaving keyboard users no way to open the file picker. -->
					<input
						id="banner-image"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						class="sr-only"
						aria-invalid={fileError ? true : undefined}
						aria-describedby={fileError
							? 'banner-image-help banner-image-error'
							: 'banner-image-help'}
						onchange={handleFileChange}
					/>
				</label>
				{#if fileError}
					<p id="banner-image-error" class="text-sm font-medium text-destructive">{fileError}</p>
				{/if}
			</div>
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
	screens={[$formData.screen_type]}
	emptyMessage="เลือกรูปก่อนจึงจะดูตัวอย่างได้"
/>

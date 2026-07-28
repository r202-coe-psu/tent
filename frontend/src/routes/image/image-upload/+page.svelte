<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LOGIN_ROUTE } from '$lib/guards/auth';
	import { getShelterCode } from '$lib/db/shelter';
	import { imageRepository, type ImageSummary } from '$lib/features/images';
	import { formatBytes, compressionRatio } from '$lib/utils/image-compress';

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGIN_ROUTE));
	}

	// ---------------------------------------------------------------- state

	let images = $state<ImageSummary[]>([]);
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadError = $state('');

	// Drag & Drop
	let isDragOver = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let cameraInput = $state<HTMLInputElement>();

	// Gallery / Lightbox
	let lightboxOpen = $state(false);
	let lightboxUrl = $state<string | null>(null);
	let lightboxImage = $state<ImageSummary | null>(null);
	let thumbnailUrls = $state<Record<string, string>>({});
	let deleting = $state<string | null>(null);

	// Upload preview
	let previewFiles = $state<File[]>([]);
	let previewUrls = $state<string[]>([]);
	let caption = $state('');

	const repo = imageRepository();

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'unknown' };
	}

	// ---------------------------------------------------------------- lifecycle

	onMount(() => {
		loadImages();

		return () => {
			// Clean up thumbnail object URLs
			Object.values(thumbnailUrls).forEach(URL.revokeObjectURL);
			previewUrls.forEach(URL.revokeObjectURL);
			if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
		};
	});

	// The dialog's own overlay-click / Escape / close-button handling flips
	// `lightboxOpen` to false without going through `closeLightbox` — release
	// the object URL + selected image whenever that happens.
	$effect(() => {
		if (!lightboxOpen && lightboxUrl) {
			URL.revokeObjectURL(lightboxUrl);
			lightboxUrl = null;
			lightboxImage = null;
		}
	});

	// ---------------------------------------------------------------- helpers

	async function loadImages() {
		images = await repo.listImages();
		// Load thumbnails for new images
		for (const img of images) {
			if (!thumbnailUrls[img._id]) {
				const url = await repo.getThumbnailUrl(img._id);
				if (url) {
					thumbnailUrls = { ...thumbnailUrls, [img._id]: url };
				}
			}
		}
	}

	function addFiles(files: FileList | File[]) {
		const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
		if (arr.length === 0) return;

		// Clean up old previews
		previewUrls.forEach(URL.revokeObjectURL);
		previewFiles = arr;
		previewUrls = arr.map((f) => URL.createObjectURL(f));
	}

	async function uploadFiles() {
		if (previewFiles.length === 0) return;
		uploading = true;
		uploadError = '';
		uploadProgress = 0;

		try {
			for (let i = 0; i < previewFiles.length; i++) {
				uploadProgress = Math.round(((i + 0.5) / previewFiles.length) * 100);
				await repo.saveImage(previewFiles[i], ctx(), caption);
				uploadProgress = Math.round(((i + 1) / previewFiles.length) * 100);
			}
			// Clear preview
			previewUrls.forEach(URL.revokeObjectURL);
			previewFiles = [];
			previewUrls = [];
			caption = '';
			await loadImages();
		} catch (e) {
			uploadError = (e as Error).message;
		} finally {
			uploading = false;
		}
	}

	function cancelPreview() {
		previewUrls.forEach(URL.revokeObjectURL);
		previewFiles = [];
		previewUrls = [];
		uploadError = '';
	}

	async function openLightbox(img: ImageSummary) {
		lightboxImage = img;
		lightboxUrl = null;
		lightboxOpen = true;
		const url = await repo.getFullImageUrl(img._id);
		lightboxUrl = url;
	}

	async function deleteImage(img: ImageSummary) {
		if (!confirm(`ลบรูป "${img.filename}" ใช่ไหม?`)) return;
		deleting = img._id;
		try {
			// Revoke thumbnail URL
			if (thumbnailUrls[img._id]) {
				URL.revokeObjectURL(thumbnailUrls[img._id]);
				const next = { ...thumbnailUrls };
				delete next[img._id];
				thumbnailUrls = next;
			}
			await repo.deleteImage(img._id, img._rev);
			await loadImages();
		} catch (e) {
			alert(`ลบไม่ได้: ${(e as Error).message}`);
		} finally {
			deleting = null;
		}
	}

	// ---------------------------------------------------------------- drag & drop handlers

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		isDragOver = true;
	}

	function onDragLeave() {
		isDragOver = false;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		isDragOver = false;
		const files = e.dataTransfer?.files;
		if (files) addFiles(files);
	}

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) addFiles(input.files);
	}

	const totalOriginal = $derived(images.reduce((s, i) => s + i.original_size, 0));
	const totalCompressed = $derived(images.reduce((s, i) => s + i.compressed_size, 0));
	const totalSaved = $derived(totalOriginal - totalCompressed);
</script>

<svelte:head>
	<title>POC: Image Upload — Smart Shelter</title>
	<meta
		name="description"
		content="Proof of Concept สำหรับการเก็บรูปภาพใน CouchDB ผ่าน Attachments API"
	/>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	<!-- ROOT HEADER -->
	<header class="flex items-center justify-end gap-4 border-b bg-background px-6 py-3">
		<span class="text-sm text-muted-foreground">{authStore.user?.name}</span>
		<Button variant="outline" size="sm" onclick={logout}>Logout</Button>
	</header>

	<!-- HEADER -->
	<header class="border-b bg-gradient-to-br from-primary-muted to-muted px-6 py-6 md:px-8">
		<div class="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-6">
			<div class="flex items-center gap-4">
				<Badge class="tracking-widest uppercase">POC</Badge>
				<div>
					<h1 class="text-2xl font-extrabold text-foreground">Image Storage</h1>
					<p class="mt-0.5 text-sm text-muted-foreground">
						CouchDB Attachments — remote-first HTTP
					</p>
				</div>
			</div>
			<div class="flex flex-wrap gap-4">
				<div class="flex flex-col items-end rounded-lg border bg-card px-4 py-2.5 shadow-sm">
					<span class="text-xl leading-none font-extrabold text-primary">{images.length}</span>
					<span class="mt-0.5 text-[11px] text-muted-foreground">รูปทั้งหมด</span>
				</div>
				<div class="flex flex-col items-end rounded-lg border bg-card px-4 py-2.5 shadow-sm">
					<span class="text-xl leading-none font-extrabold text-primary"
						>{formatBytes(totalCompressed)}</span
					>
					<span class="mt-0.5 text-[11px] text-muted-foreground">ขนาดใน DB</span>
				</div>
				{#if totalSaved > 0}
					<div class="flex flex-col items-end rounded-lg border bg-card px-4 py-2.5 shadow-sm">
						<span class="text-xl leading-none font-extrabold text-success"
							>-{formatBytes(totalSaved)}</span
						>
						<span class="mt-0.5 text-[11px] text-muted-foreground">
							ประหยัด ({compressionRatio(totalOriginal, totalCompressed)})
						</span>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<div
		class="mx-auto grid max-w-[1400px] grid-cols-1 items-start gap-6 p-4 lg:grid-cols-[360px_1fr] lg:p-8"
	>
		<!-- LEFT: Upload -->
		<aside>
			<Card class="p-6">
				<h2 class="text-base font-bold tracking-wide text-foreground">📤 อัปโหลดรูป</h2>

				<!-- Drag & Drop -->
				<div
					id="drop-zone"
					class="cursor-pointer rounded-xl border-2 border-dashed bg-muted/40 p-8 text-center transition-all hover:border-primary hover:bg-primary-muted {isDragOver
						? 'scale-[1.01] border-primary bg-primary-muted'
						: 'border-border'}"
					role="button"
					tabindex="0"
					ondragover={onDragOver}
					ondragleave={onDragLeave}
					ondrop={onDrop}
					onclick={() => fileInput?.click()}
					onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
				>
					<div class="text-4xl">🖼️</div>
					<p class="mt-2 font-semibold text-foreground">วาง หรือ คลิกเพื่อเลือกรูป</p>
					<p class="mt-1 text-xs text-muted-foreground">รองรับ JPG, PNG, WebP, HEIC</p>
					<p class="text-xs text-muted-foreground">Max 1024px • quality 80% • auto-resize</p>
				</div>

				<!-- Hidden inputs -->
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					multiple
					class="hidden"
					onchange={onFileChange}
				/>
				<input
					bind:this={cameraInput}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={onFileChange}
				/>

				<Button variant="secondary" class="mt-3 w-full" onclick={() => cameraInput?.click()}>
					📷 ถ่ายรูปจากกล้อง
				</Button>

				<!-- Preview -->
				{#if previewFiles.length > 0}
					<div class="mt-4 space-y-3">
						<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
							{#each previewUrls as url, i (url)}
								<div class="flex flex-col items-center gap-1">
									<img
										src={url}
										alt={previewFiles[i].name}
										class="h-20 w-20 rounded-lg border object-cover"
									/>
									<span class="w-20 truncate text-center text-[10px] text-muted-foreground"
										>{previewFiles[i].name}</span
									>
									<span class="text-[10px] text-muted-foreground"
										>{formatBytes(previewFiles[i].size)}</span
									>
								</div>
							{/each}
						</div>

						<Input
							id="caption-input"
							type="text"
							placeholder="คำอธิบายรูป (optional)"
							bind:value={caption}
						/>

						{#if uploadError}
							<p class="text-sm text-destructive">❌ {uploadError}</p>
						{/if}

						{#if uploading}
							<div class="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-primary transition-all"
									style:width="{uploadProgress}%"
								></div>
							</div>
							<p class="text-center text-xs text-primary">กำลังอัปโหลด {uploadProgress}%…</p>
						{:else}
							<div class="flex gap-2">
								<Button class="flex-1" onclick={uploadFiles} disabled={uploading}>
									✅ บันทึก {previewFiles.length} รูป
								</Button>
								<Button variant="outline" onclick={cancelPreview}>ยกเลิก</Button>
							</div>
						{/if}
					</div>
				{/if}
			</Card>
		</aside>

		<!-- RIGHT: Gallery -->
		<main class="min-h-[400px]">
			<div class="mb-5 flex items-center justify-between">
				<h2 class="text-base font-bold tracking-wide text-foreground">
					🖼️ Gallery ({images.length} รูป)
				</h2>
			</div>

			{#if images.length === 0}
				<div class="flex h-[300px] flex-col items-center justify-center text-muted-foreground">
					<div class="text-6xl">📭</div>
					<p class="mt-3 text-base">ยังไม่มีรูปภาพ</p>
					<p class="mt-1.5 text-sm text-muted-foreground">อัปโหลดรูปทางซ้ายเพื่อเริ่มต้น</p>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{#each images as img (img._id)}
						<Card
							class="group relative gap-0 overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:shadow-md {deleting ===
							img._id
								? 'pointer-events-none opacity-50'
								: ''}"
						>
							<!-- Thumbnail -->
							<button
								class="block aspect-square w-full overflow-hidden bg-muted"
								onclick={() => openLightbox(img)}
								title="ดูรูปเต็ม"
								aria-label="ดูรูป {img.filename}"
							>
								{#if thumbnailUrls[img._id]}
									<img
										src={thumbnailUrls[img._id]}
										alt={img.filename}
										class="h-full w-full object-cover transition-transform group-hover:scale-105"
										loading="lazy"
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center text-2xl">⏳</div>
								{/if}
							</button>

							<!-- Metadata -->
							<div class="p-3">
								<p class="truncate text-xs font-semibold text-foreground" title={img.filename}>
									{img.filename}
								</p>
								{#if img.caption}
									<p class="truncate text-[11px] text-muted-foreground italic">{img.caption}</p>
								{/if}
								<div class="mt-1 flex gap-1.5 text-[11px] text-muted-foreground">
									<span>{img.width}×{img.height}</span>
									<span>{formatBytes(img.compressed_size)}</span>
									<span class="font-semibold text-success"
										>-{compressionRatio(img.original_size, img.compressed_size)}</span
									>
								</div>
								<p class="mt-0.5 text-[10px] text-muted-foreground">
									{new Date(img.created_at).toLocaleString('th-TH', {
										dateStyle: 'medium',
										timeStyle: 'short'
									})}
								</p>
							</div>

							<!-- Delete -->
							<button
								class="absolute top-2 right-2 rounded-md bg-background/90 px-2 py-1 text-sm opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
								onclick={() => deleteImage(img)}
								disabled={deleting === img._id}
								title="ลบรูป"
								aria-label="ลบรูป {img.filename}"
							>
								{deleting === img._id ? '⏳' : '🗑️'}
							</button>
						</Card>
					{/each}
				</div>
			{/if}
		</main>
	</div>
</div>

<!-- ============================================================ LIGHTBOX -->
<Dialog.Root bind:open={lightboxOpen}>
	<Dialog.Content
		class="max-w-[min(90vw,1000px)] gap-0 overflow-hidden p-0 sm:max-w-[min(90vw,1000px)]"
	>
		{#if lightboxImage}
			<Dialog.Title class="sr-only">รูปภาพ {lightboxImage.filename}</Dialog.Title>
			<Dialog.Description class="sr-only">{lightboxImage.caption}</Dialog.Description>

			{#if lightboxUrl}
				<img
					src={lightboxUrl}
					alt={lightboxImage.filename}
					class="max-h-[70vh] w-full bg-muted object-contain"
				/>
			{:else}
				<div
					class="flex h-[300px] w-full flex-col items-center justify-center gap-4 text-muted-foreground"
				>
					<div
						class="h-10 w-10 animate-spin rounded-full border-3 border-muted border-t-primary"
					></div>
					<p>กำลังโหลดรูปเต็ม…</p>
				</div>
			{/if}

			<div class="border-t bg-muted/40 px-6 py-4">
				<p class="font-bold text-foreground">{lightboxImage.filename}</p>
				{#if lightboxImage.caption}
					<p class="mt-1 text-sm text-muted-foreground italic">{lightboxImage.caption}</p>
				{/if}
				<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>{lightboxImage.width} × {lightboxImage.height} px</span>
					<span>|</span>
					<span>ต้นฉบับ: {formatBytes(lightboxImage.original_size)}</span>
					<span>→</span>
					<span>หลัง compress: {formatBytes(lightboxImage.compressed_size)}</span>
					<span class="font-semibold text-success">
						ประหยัด {compressionRatio(lightboxImage.original_size, lightboxImage.compressed_size)}
					</span>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

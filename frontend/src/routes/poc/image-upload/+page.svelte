<script lang="ts">
	import { onMount } from 'svelte';
	import { pocImageRepository, type ImageSummary } from '$lib/features/poc-image';
	import { formatBytes, compressionRatio } from '$lib/utils/image-compress';
	import SyncStatus from '$lib/features/poc-image/ui/sync-status.svelte';

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
	let lightboxUrl = $state<string | null>(null);
	let lightboxImage = $state<ImageSummary | null>(null);
	let thumbnailUrls = $state<Record<string, string>>({});
	let deleting = $state<string | null>(null);

	// Upload preview
	let previewFiles = $state<File[]>([]);
	let previewUrls = $state<string[]>([]);
	let caption = $state('');

	const repo = pocImageRepository();

	// ---------------------------------------------------------------- lifecycle

	onMount(() => {
		loadImages();

		// Watch for changes (e.g. sync from remote)
		const unsubscribe = repo.watchChanges(loadImages);
		return () => {
			unsubscribe();
			// Clean up thumbnail object URLs
			Object.values(thumbnailUrls).forEach(URL.revokeObjectURL);
		};
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
				await repo.saveImage(previewFiles[i], caption);
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
		const url = await repo.getFullImageUrl(img._id);
		lightboxUrl = url;
	}

	function closeLightbox() {
		if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
		lightboxUrl = null;
		lightboxImage = null;
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
			await repo.deleteImage(img._id);
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

	// Keyboard: close lightbox on Escape
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && lightboxImage) closeLightbox();
	}

	const totalOriginal = $derived(images.reduce((s, i) => s + i.original_size, 0));
	const totalCompressed = $derived(images.reduce((s, i) => s + i.compressed_size, 0));
	const totalSaved = $derived(totalOriginal - totalCompressed);
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>POC: Image Upload — Smart Shelter</title>
	<meta name="description" content="Proof of Concept สำหรับการเก็บรูปภาพใน CouchDB ผ่าน Attachments API" />
</svelte:head>

<!-- ============================================================ LAYOUT -->
<div class="poc-root">

	<!-- HEADER -->
	<header class="poc-header">
		<div class="header-inner">
			<div class="header-left">
				<span class="badge">POC</span>
				<div>
					<h1 class="title">Image Storage</h1>
					<p class="subtitle">CouchDB Attachments via PouchDB</p>
				</div>
			</div>
			<div class="stats-row">
				<div class="stat">
					<span class="stat-val">{images.length}</span>
					<span class="stat-label">รูปทั้งหมด</span>
				</div>
				<div class="stat">
					<span class="stat-val">{formatBytes(totalCompressed)}</span>
					<span class="stat-label">ขนาดใน DB</span>
				</div>
				{#if totalSaved > 0}
					<div class="stat stat-green">
						<span class="stat-val">-{formatBytes(totalSaved)}</span>
						<span class="stat-label">ประหยัด ({compressionRatio(totalOriginal, totalCompressed)})</span>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<div class="poc-body">
		<!-- LEFT: Upload + Sync -->
		<aside class="poc-sidebar">

			<!-- UPLOAD ZONE -->
			<section class="upload-section card">
				<h2 class="section-title">📤 อัปโหลดรูป</h2>

				<!-- Drag & Drop -->
				<div
					id="drop-zone"
					class="drop-zone"
					class:drag-over={isDragOver}
					role="button"
					tabindex="0"
					ondragover={onDragOver}
					ondragleave={onDragLeave}
					ondrop={onDrop}
					onclick={() => fileInput?.click()}
					onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
				>
					<div class="drop-icon">🖼️</div>
					<p class="drop-text">วาง หรือ คลิกเพื่อเลือกรูป</p>
					<p class="drop-hint">รองรับ JPG, PNG, WebP, HEIC</p>
					<p class="drop-hint">Max 1024px • quality 80% • auto-resize</p>
				</div>

				<!-- Hidden inputs -->
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					multiple
					style="display:none"
					onchange={onFileChange}
				/>
				<input
					bind:this={cameraInput}
					type="file"
					accept="image/*"
					capture="environment"
					style="display:none"
					onchange={onFileChange}
				/>

				<button class="camera-btn" onclick={() => cameraInput?.click()}>
					📷 ถ่ายรูปจากกล้อง
				</button>

				<!-- Preview -->
				{#if previewFiles.length > 0}
					<div class="preview-section">
						<div class="preview-grid">
							{#each previewUrls as url, i (url)}
								<div class="preview-item">
									<img src={url} alt={previewFiles[i].name} class="preview-img" />
									<span class="preview-name">{previewFiles[i].name}</span>
									<span class="preview-size">{formatBytes(previewFiles[i].size)}</span>
								</div>
							{/each}
						</div>

						<div class="caption-row">
							<input
								id="caption-input"
								type="text"
								placeholder="คำอธิบายรูป (optional)"
								bind:value={caption}
								class="caption-input"
							/>
						</div>

						{#if uploadError}
							<p class="error-msg">❌ {uploadError}</p>
						{/if}

						{#if uploading}
							<div class="progress-bar">
								<div class="progress-fill" style:width="{uploadProgress}%"></div>
							</div>
							<p class="progress-label">กำลังอัปโหลด {uploadProgress}%…</p>
						{:else}
							<div class="preview-actions">
								<button class="btn-upload" onclick={uploadFiles} disabled={uploading}>
									✅ บันทึก {previewFiles.length} รูป
								</button>
								<button class="btn-cancel" onclick={cancelPreview}>ยกเลิก</button>
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- SYNC PANEL -->
			<section class="card">
				<h2 class="section-title">🔄 Sync Status</h2>
				<SyncStatus />
				<div class="sync-tip">
					<p>💡 <strong>ทดสอบ Offline Sync:</strong></p>
					<ol>
						<li>กด Stop Sync หรือปิด Network</li>
						<li>อัปโหลดรูปใหม่</li>
						<li>กด Start Sync หรือเปิด Network</li>
						<li>ดู log ว่า Push สำเร็จไหม</li>
					</ol>
				</div>
			</section>
		</aside>

		<!-- RIGHT: Gallery -->
		<main class="poc-main">
			<div class="gallery-header">
				<h2 class="section-title">🖼️ Gallery ({images.length} รูป)</h2>
			</div>

			{#if images.length === 0}
				<div class="empty-gallery">
					<div class="empty-icon">📭</div>
					<p>ยังไม่มีรูปภาพ</p>
					<p class="empty-hint">อัปโหลดรูปทางซ้ายเพื่อเริ่มต้น</p>
				</div>
			{:else}
				<div class="gallery-grid">
					{#each images as img (img._id)}
						<div class="gallery-card" class:deleting={deleting === img._id}>
							<!-- Thumbnail -->
							<button
								class="thumb-btn"
								onclick={() => openLightbox(img)}
								title="ดูรูปเต็ม"
								aria-label="ดูรูป {img.filename}"
							>
								{#if thumbnailUrls[img._id]}
									<img
										src={thumbnailUrls[img._id]}
										alt={img.filename}
										class="thumb-img"
										loading="lazy"
									/>
								{:else}
									<div class="thumb-loading">⏳</div>
								{/if}
							</button>

							<!-- Metadata -->
							<div class="card-info">
								<p class="card-filename" title={img.filename}>{img.filename}</p>
								{#if img.caption}
									<p class="card-caption">{img.caption}</p>
								{/if}
								<div class="card-meta">
									<span class="meta-dim">{img.width}×{img.height}</span>
									<span class="meta-size">{formatBytes(img.compressed_size)}</span>
									<span class="meta-saved">-{compressionRatio(img.original_size, img.compressed_size)}</span>
								</div>
								<p class="card-date">
									{new Date(img.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
								</p>
							</div>

							<!-- Delete -->
							<button
								class="delete-btn"
								onclick={() => deleteImage(img)}
								disabled={deleting === img._id}
								title="ลบรูป"
								aria-label="ลบรูป {img.filename}"
							>
								{deleting === img._id ? '⏳' : '🗑️'}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</main>
	</div>
</div>

<!-- ============================================================ LIGHTBOX -->
{#if lightboxImage}
	<div
		class="lightbox-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="รูปภาพ {lightboxImage.filename}"
		onclick={closeLightbox}
	>
		<div class="lightbox-content" onclick={(e) => e.stopPropagation()}>
			<button class="lightbox-close" onclick={closeLightbox} aria-label="ปิด">✕</button>

			{#if lightboxUrl}
				<img src={lightboxUrl} alt={lightboxImage.filename} class="lightbox-img" />
			{:else}
				<div class="lightbox-loading">
					<div class="loading-spinner"></div>
					<p>กำลังโหลดรูปเต็ม…</p>
				</div>
			{/if}

			<div class="lightbox-meta">
				<p class="lb-filename">{lightboxImage.filename}</p>
				{#if lightboxImage.caption}
					<p class="lb-caption">{lightboxImage.caption}</p>
				{/if}
				<div class="lb-stats">
					<span>{lightboxImage.width} × {lightboxImage.height} px</span>
					<span>|</span>
					<span>ต้นฉบับ: {formatBytes(lightboxImage.original_size)}</span>
					<span>→</span>
					<span>หลัง compress: {formatBytes(lightboxImage.compressed_size)}</span>
					<span class="lb-saved">ประหยัด {compressionRatio(lightboxImage.original_size, lightboxImage.compressed_size)}</span>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ===================== RESET / ROOT ===================== */
	.poc-root {
		min-height: 100vh;
		background: #0f0f1a;
		color: #e2e8f0;
		font-family: 'Inter', system-ui, sans-serif;
	}

	/* ===================== HEADER ===================== */
	.poc-header {
		background: linear-gradient(135deg, #1a1a3e 0%, #16213e 50%, #0f3460 100%);
		border-bottom: 1px solid #2d2d6e;
		padding: 24px 32px;
	}

	.header-inner {
		max-width: 1400px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.badge {
		background: linear-gradient(135deg, #7c3aed, #4f46e5);
		color: white;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.15em;
		padding: 4px 10px;
		border-radius: 6px;
	}

	.title {
		font-size: 28px;
		font-weight: 800;
		background: linear-gradient(135deg, #a5b4fc, #818cf8, #6366f1);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		margin: 0;
	}

	.subtitle {
		color: #64748b;
		font-size: 13px;
		margin: 2px 0 0;
	}

	.stats-row {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 10px 16px;
	}

	.stat-val {
		font-size: 22px;
		font-weight: 800;
		color: #a5b4fc;
		line-height: 1;
	}

	.stat-label {
		font-size: 11px;
		color: #64748b;
		margin-top: 2px;
	}

	.stat-green .stat-val { color: #6ee7b7; }

	/* ===================== BODY ===================== */
	.poc-body {
		max-width: 1400px;
		margin: 0 auto;
		padding: 32px;
		display: grid;
		grid-template-columns: 360px 1fr;
		gap: 24px;
		align-items: start;
	}

	@media (max-width: 900px) {
		.poc-body { grid-template-columns: 1fr; padding: 16px; }
	}

	.card {
		background: #111827;
		border: 1px solid #1f2937;
		border-radius: 16px;
		padding: 24px;
		margin-bottom: 20px;
	}

	.section-title {
		font-size: 16px;
		font-weight: 700;
		color: #c7d2fe;
		margin: 0 0 16px;
		letter-spacing: 0.02em;
	}

	/* ===================== UPLOAD ===================== */
	.drop-zone {
		border: 2px dashed #374151;
		border-radius: 12px;
		padding: 32px 24px;
		text-align: center;
		cursor: pointer;
		transition: all 0.25s;
		background: #0d1117;
	}

	.drop-zone:hover, .drop-zone.drag-over {
		border-color: #6366f1;
		background: rgba(99, 102, 241, 0.06);
		transform: scale(1.01);
	}

	.drop-icon { font-size: 36px; margin-bottom: 8px; }
	.drop-text { color: #c7d2fe; font-weight: 600; margin: 0 0 4px; }
	.drop-hint { color: #475569; font-size: 12px; margin: 2px 0 0; }

	.camera-btn {
		width: 100%;
		margin-top: 12px;
		background: rgba(99, 102, 241, 0.12);
		border: 1px solid rgba(99, 102, 241, 0.3);
		color: #a5b4fc;
		border-radius: 10px;
		padding: 10px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.camera-btn:hover {
		background: rgba(99, 102, 241, 0.25);
		color: #c7d2fe;
	}

	/* Preview */
	.preview-section { margin-top: 16px; }

	.preview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		gap: 8px;
		margin-bottom: 12px;
	}

	.preview-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
	}

	.preview-img {
		width: 80px;
		height: 80px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid #1f2937;
	}

	.preview-name {
		font-size: 10px;
		color: #64748b;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
		max-width: 80px;
		text-align: center;
	}

	.preview-size { font-size: 10px; color: #475569; }

	.caption-row { margin-bottom: 12px; }

	.caption-input {
		width: 100%;
		background: #0d1117;
		border: 1px solid #374151;
		border-radius: 8px;
		color: #e2e8f0;
		padding: 8px 12px;
		font-size: 13px;
		box-sizing: border-box;
		transition: border-color 0.2s;
	}

	.caption-input:focus {
		outline: none;
		border-color: #6366f1;
	}

	.caption-input::placeholder { color: #475569; }

	.preview-actions {
		display: flex;
		gap: 8px;
	}

	.btn-upload {
		flex: 1;
		background: linear-gradient(135deg, #4f46e5, #7c3aed);
		color: white;
		border: none;
		border-radius: 10px;
		padding: 10px;
		font-weight: 700;
		font-size: 13px;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.btn-upload:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-upload:not(:disabled):hover { opacity: 0.85; }

	.btn-cancel {
		background: #1f2937;
		color: #9ca3af;
		border: 1px solid #374151;
		border-radius: 10px;
		padding: 10px 16px;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-cancel:hover { background: #374151; color: #e2e8f0; }

	.progress-bar {
		height: 6px;
		background: #1f2937;
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 6px;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4f46e5, #7c3aed);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.progress-label { font-size: 12px; color: #a5b4fc; text-align: center; }
	.error-msg { color: #fca5a5; font-size: 13px; margin-bottom: 8px; }

	/* Sync tip */
	.sync-tip {
		margin-top: 16px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: 10px;
		padding: 14px 16px;
		font-size: 13px;
		color: #94a3b8;
	}

	.sync-tip p { margin: 0 0 8px; }
	.sync-tip strong { color: #a5b4fc; }
	.sync-tip ol { margin: 0; padding-left: 18px; }
	.sync-tip li { margin-bottom: 4px; }

	/* ===================== GALLERY ===================== */
	.poc-main { min-height: 400px; }

	.gallery-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
	}

	.empty-gallery {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 300px;
		color: #374151;
	}

	.empty-icon { font-size: 64px; margin-bottom: 12px; }
	.empty-gallery p { font-size: 16px; margin: 0; }
	.empty-hint { font-size: 13px; color: #4b5563 !important; margin-top: 6px !important; }

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 16px;
	}

	.gallery-card {
		background: #111827;
		border: 1px solid #1f2937;
		border-radius: 14px;
		overflow: hidden;
		transition: all 0.25s;
		position: relative;
	}

	.gallery-card:hover {
		border-color: #4338ca;
		box-shadow: 0 0 20px rgba(67, 56, 202, 0.2);
		transform: translateY(-2px);
	}

	.gallery-card.deleting { opacity: 0.5; pointer-events: none; }

	.thumb-btn {
		display: block;
		width: 100%;
		border: none;
		background: #0d1117;
		cursor: pointer;
		padding: 0;
		aspect-ratio: 1;
		overflow: hidden;
	}

	.thumb-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.3s;
	}

	.gallery-card:hover .thumb-img { transform: scale(1.05); }

	.thumb-loading {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		background: #0d1117;
	}

	.card-info {
		padding: 12px;
	}

	.card-filename {
		font-size: 12px;
		font-weight: 600;
		color: #c7d2fe;
		margin: 0 0 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-caption {
		font-size: 11px;
		color: #94a3b8;
		margin: 0 0 6px;
		font-style: italic;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-meta {
		display: flex;
		gap: 6px;
		font-size: 11px;
		color: #475569;
		margin-bottom: 4px;
	}

	.meta-saved { color: #6ee7b7; }
	.card-date { font-size: 10px; color: #374151; margin: 0; }

	.delete-btn {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0, 0, 0, 0.7);
		border: none;
		border-radius: 8px;
		padding: 4px 8px;
		cursor: pointer;
		font-size: 14px;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.gallery-card:hover .delete-btn { opacity: 1; }
	.delete-btn:hover { background: rgba(239, 68, 68, 0.8); }

	/* ===================== LIGHTBOX ===================== */
	.lightbox-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.92);
		backdrop-filter: blur(8px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.lightbox-content {
		position: relative;
		max-width: min(90vw, 1000px);
		max-height: 90vh;
		background: #111827;
		border: 1px solid #1f2937;
		border-radius: 20px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		animation: scaleIn 0.2s ease;
	}

	@keyframes scaleIn {
		from { transform: scale(0.95); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}

	.lightbox-close {
		position: absolute;
		top: 12px;
		right: 12px;
		background: rgba(0, 0, 0, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: white;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 16px;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.lightbox-close:hover {
		background: rgba(239, 68, 68, 0.7);
		border-color: #ef4444;
	}

	.lightbox-img {
		max-width: 100%;
		max-height: 70vh;
		object-fit: contain;
		display: block;
	}

	.lightbox-loading {
		width: 400px;
		height: 300px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		color: #64748b;
	}

	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 3px solid #1f2937;
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.lightbox-meta {
		padding: 16px 24px;
		border-top: 1px solid #1f2937;
		background: #0d1117;
	}

	.lb-filename {
		font-weight: 700;
		color: #c7d2fe;
		margin: 0 0 4px;
		font-size: 15px;
	}

	.lb-caption {
		color: #94a3b8;
		font-style: italic;
		margin: 0 0 8px;
		font-size: 13px;
	}

	.lb-stats {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #475569;
		flex-wrap: wrap;
	}

	.lb-saved {
		color: #6ee7b7;
		font-weight: 600;
	}
</style>

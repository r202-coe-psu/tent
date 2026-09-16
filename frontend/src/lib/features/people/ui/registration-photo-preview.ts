/**
 * Session cache for face/pet photo previews after upload.
 * Blob URLs are lost on remount; ids (`image:…` / `gfs:…`) stay on the model —
 * resolve from cache, or staff Couch thumbnail for onsite `image:` refs.
 */
import { imageRepository } from '$lib/features/images';
import type { MemberPhotoUploadMode } from '../domain/unified-registration';

const previewById = new Map<string, string>();

export function rememberPhotoPreview(photoId: string, url: string): void {
	const prev = previewById.get(photoId);
	if (prev && prev !== url && prev.startsWith('blob:')) {
		URL.revokeObjectURL(prev);
	}
	previewById.set(photoId, url);
}

export function recallPhotoPreview(photoId: string | null | undefined): string | null {
	if (!photoId) return null;
	return previewById.get(photoId) ?? null;
}

export function forgetPhotoPreview(photoId: string | null | undefined): void {
	if (!photoId) return;
	const url = previewById.get(photoId);
	if (url?.startsWith('blob:')) {
		URL.revokeObjectURL(url);
	}
	previewById.delete(photoId);
}

/**
 * Resolve a displayable preview URL for a stored photo id.
 * - Session cache (blob / object URL) first
 * - Onsite Couch `image:` → thumbnail attachment
 * - Public `image:` / `gfs:` → cache only until a public read endpoint exists
 */
export async function resolvePhotoPreviewUrl(
	photoId: string | null | undefined,
	mode: MemberPhotoUploadMode | 'pet-onsite' | 'pet-public'
): Promise<string | null> {
	if (!photoId) return null;
	const cached = recallPhotoPreview(photoId);
	if (cached) return cached;

	if (
		photoId.startsWith('data:image/') ||
		photoId.startsWith('blob:') ||
		photoId.startsWith('http://') ||
		photoId.startsWith('https://')
	) {
		return photoId;
	}

	if (!photoId.includes(':') && photoId.length > 50) {
		return `data:image/jpeg;base64,${photoId}`;
	}

	const isOnsiteImage =
		photoId.startsWith('image:') && (mode === 'onsite-couch' || mode === 'pet-onsite');
	if (isOnsiteImage) {
		try {
			return await imageRepository().getThumbnailUrl(photoId);
		} catch {
			return null;
		}
	}

	return null;
}

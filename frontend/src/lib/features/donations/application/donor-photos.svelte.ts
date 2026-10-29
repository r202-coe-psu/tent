import {
	DONATION_PHOTO_MAX_ORIGINAL_BYTES,
	donorPhotoBudget,
	donorPhotoFits,
	type DonorPhoto
} from '../domain/donation-photos';
import { compressDonorPhoto, uploadDonorPhoto } from '../data/donor-photo-upload';

/** Why a picked file did not join the booking — the form words each one for the donor. */
export type DonorPhotoRefusal = 'original_too_large' | 'no_room' | 'unreadable' | 'upload_failed';

export interface DonorPhotoDeps {
	compress: typeof compressDonorPhoto;
	upload: typeof uploadDonorPhoto;
	previewUrl: (blob: Blob) => string;
	revokeUrl: (url: string) => void;
}

const browserDeps: DonorPhotoDeps = {
	compress: compressDonorPhoto,
	upload: uploadDonorPhoto,
	previewUrl: (blob) => URL.createObjectURL(blob),
	revokeUrl: (url) => URL.revokeObjectURL(url)
};

/**
 * The photos a donor attaches to an unsolicited booking (CR-175 donor photos FR-3..FR-8).
 *
 * Each picked file is checked (≤ 20 MB original), compressed, counted against 30 photos
 * and 10 MB, then uploaded at once. Files are taken one at a time, so the count and the
 * size a later file is judged against already include every earlier one.
 */
export class DonorPhotos {
	items = $state<DonorPhoto[]>([]);
	/** Files picked but not yet compressed — the picker stays busy until they are. */
	preparing = $state(0);

	readonly budget = $derived(donorPhotoBudget(this.items));
	readonly busy = $derived(this.preparing > 0 || this.items.some((p) => p.state === 'uploading'));
	/** What the booking sends — only photos the BFF has stored. */
	readonly photoIds = $derived(this.items.flatMap((p) => (p.state === 'ready' ? [p.photoId] : [])));

	#nextKey = 0;

	constructor(private readonly deps: DonorPhotoDeps = browserDeps) {}

	async add(
		files: readonly File[],
		shelterCode: string,
		refuse: (reason: DonorPhotoRefusal, file: File) => void
	): Promise<void> {
		this.preparing += files.length;
		for (const file of files) {
			try {
				await this.#addOne(file, shelterCode, refuse);
			} finally {
				this.preparing -= 1;
			}
		}
	}

	async #addOne(
		file: File,
		shelterCode: string,
		refuse: (reason: DonorPhotoRefusal, file: File) => void
	): Promise<void> {
		if (file.size > DONATION_PHOTO_MAX_ORIGINAL_BYTES) return refuse('original_too_large', file);
		if (this.budget.full) return refuse('no_room', file);

		let compressed;
		try {
			compressed = await this.deps.compress(file);
		} catch {
			return refuse('unreadable', file);
		}
		if (!donorPhotoFits(this.items, compressed.bytes)) return refuse('no_room', file);

		const key = `photo-${this.#nextKey++}`;
		const previewUrl = this.deps.previewUrl(compressed.compressed.thumbnail);
		this.items.push({ key, state: 'uploading', previewUrl, bytes: compressed.bytes });

		try {
			const photoId = await this.deps.upload(shelterCode, file, compressed);
			this.items = this.items.map((p) =>
				p.key === key ? { key, state: 'ready', previewUrl, bytes: p.bytes, photoId } : p
			);
		} catch {
			this.#drop(key);
			refuse('upload_failed', file);
		}
	}

	/** Take a photo off the booking. An uploaded one is swept by the worker after 24 h (FR-16). */
	remove(key: string): void {
		this.#drop(key);
	}

	clear(): void {
		for (const p of this.items) this.deps.revokeUrl(p.previewUrl);
		this.items = [];
	}

	#drop(key: string): void {
		const photo = this.items.find((p) => p.key === key);
		if (!photo) return;
		this.deps.revokeUrl(photo.previewUrl);
		this.items = this.items.filter((p) => p.key !== key);
	}
}

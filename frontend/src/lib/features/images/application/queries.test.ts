// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/svelte-query', () => ({
	createMutation: (fn: () => Record<string, unknown>) => {
		const options = fn();
		return {
			mutateAsync: (variables: unknown) => {
				const mutationFn = options.mutationFn as (v: unknown) => Promise<unknown>;
				return mutationFn(variables);
			}
		};
	}
}));

const mockSaveImage = vi.fn().mockResolvedValue({ _id: 'image:01H...', _rev: '1-abc' });
vi.mock('../data/image.remote', () => ({
	imageRepository: () => ({ saveImage: mockSaveImage })
}));

import { useSaveImage } from './queries';

describe('useSaveImage', () => {
	it('delegates to imageRepository().saveImage with the given file, ctx, caption and opts', async () => {
		const file = new File(['bytes'], 'face.jpg', { type: 'image/jpeg' });
		const ctx = { shelterCode: 'SH001', createdBy: 'staff1' };

		const mutation = useSaveImage();
		const result = await mutation.mutateAsync({ file, ctx, caption: 'face photo' });

		expect(mockSaveImage).toHaveBeenCalledWith(file, ctx, 'face photo', undefined);
		expect(result).toEqual({ _id: 'image:01H...', _rev: '1-abc' });
	});
});

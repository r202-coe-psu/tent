import { createMutation } from '@tanstack/svelte-query';
import type { AuthorContext } from '$lib/db/model';
import type { CompressOptions } from '$lib/utils/image-compress';
import { imageRepository } from '../data/image.remote';

export const useSaveImage = () =>
	createMutation(() => ({
		mutationFn: ({
			file,
			ctx,
			caption,
			opts
		}: {
			file: File;
			ctx: AuthorContext;
			caption?: string;
			opts?: CompressOptions;
		}) => imageRepository().saveImage(file, ctx, caption, opts)
	}));

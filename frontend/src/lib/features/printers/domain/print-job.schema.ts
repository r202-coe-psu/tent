import { z } from 'zod';
import { base64DecodedBytes, isPrintableLabel, MAX_LABEL_PNG_BYTES } from './label-png';

export const MAX_LABEL_BYTES = MAX_LABEL_PNG_BYTES;
export const MAX_LABELS_PER_JOB = 20;
export const MAX_JOB_BYTES = 1024 * 1024;

export const printJobSourceSchema = z.enum(['walk_in', 'evacuee_qr']);
export type PrintJobSource = z.infer<typeof printJobSourceSchema>;

/**
 * One label: base64 of a PNG of at most 64 KB whose IHDR is exactly one label in size (639x479)
 * and in an allowed bit depth / colour type (see `label-png.ts`).
 */
export const printLabelSchema = z
	.string()
	.refine((value) => base64DecodedBytes(value) <= MAX_LABEL_BYTES, 'Label exceeds 64 KB')
	.refine(isPrintableLabel, 'Label is not a valid label-size PNG');

export const printJobCreateInputSchema = z.object({
	printer_id: z.string().min(1),
	source: printJobSourceSchema,
	labels: z
		.array(printLabelSchema)
		.min(1)
		.max(MAX_LABELS_PER_JOB)
		.refine(
			(labels) =>
				labels.reduce((sum, label) => sum + base64DecodedBytes(label), 0) <= MAX_JOB_BYTES,
			'Labels exceed 1 MB in total'
		)
});
export type PrintJobCreateInput = z.infer<typeof printJobCreateInputSchema>;

export const printJobStatusSchema = z.enum(['pending', 'printing', 'printed', 'failed', 'expired']);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

export const printJobCreateResponseSchema = z.object({
	job_id: z.string(),
	/** Shelter of the job's DB `printing_{code}`; the status poll needs it (`?shelter_code=`). */
	shelter_code: z.string().min(1),
	expires_at: z.string()
});
export type PrintJobCreateResponse = z.infer<typeof printJobCreateResponseSchema>;

export const printJobStatusResponseSchema = z.object({
	status: printJobStatusSchema,
	printed: z.number().int().nonnegative(),
	label_count: z.number().int().nonnegative(),
	error_code: z.string().nullable()
});
export type PrintJobStatusResponse = z.infer<typeof printJobStatusResponseSchema>;

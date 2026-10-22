import { z } from 'zod';

export const MAX_LABELS_PER_JOB = 20;
export const MAX_LABEL_BYTES = 64 * 1024;
export const MAX_JOB_BYTES = 1024 * 1024;

export const printJobSourceSchema = z.enum(['walk_in', 'evacuee_qr']);
export type PrintJobSource = z.infer<typeof printJobSourceSchema>;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decoded size of a well-formed base64 string, without decoding it. */
export function base64DecodedBytes(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return (base64.length / 4) * 3 - padding;
}

function startsWithPngMagic(base64: string): boolean {
	// 12 base64 chars cover the first 9 bytes. Zod runs every refinement even after one failed,
	// so this must not throw on input the BASE64 check already rejected.
	try {
		const head = atob(base64.slice(0, 12));
		return PNG_MAGIC.every((byte, i) => head.charCodeAt(i) === byte);
	} catch {
		return false;
	}
}

/** One label: well-formed base64 of a PNG, at most 64 KB once decoded. */
export const printLabelSchema = z
	.string()
	.refine((value) => BASE64.test(value), 'Label is not valid base64')
	.refine((value) => base64DecodedBytes(value) >= PNG_MAGIC.length, 'Label is too short')
	.refine((value) => base64DecodedBytes(value) <= MAX_LABEL_BYTES, 'Label exceeds 64 KB')
	.refine((value) => startsWithPngMagic(value), 'Label is not a PNG');

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

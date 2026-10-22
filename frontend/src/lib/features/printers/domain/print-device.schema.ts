import { z } from 'zod';

export const printerQueueStateSchema = z.enum(['ready', 'disabled', 'missing', 'unknown']);

/** A printer as the tablet sees it (`GET /api/staff/v1/printers`, active devices only). */
export const printerSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	station: z.string().nullable().optional(),
	online: z.boolean(),
	queue_state: printerQueueStateSchema,
	last_seen_at: z.string().nullable()
});
export type PrinterSummary = z.infer<typeof printerSummarySchema>;

export const printerListResponseSchema = z.object({
	printers: z.array(printerSummarySchema),
	server_time: z.string()
});
export type PrinterListResponse = z.infer<typeof printerListResponseSchema>;

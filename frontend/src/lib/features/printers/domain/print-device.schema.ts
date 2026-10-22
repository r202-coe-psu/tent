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

// ------------------------------------------------------------ back-office admin

export const printDeviceStatusSchema = z.enum(['active', 'inactive']);
export type PrintDeviceStatus = z.infer<typeof printDeviceStatusSchema>;
export const printHostKindSchema = z.enum(['standalone', 'kiosk']);
export type PrintHostKind = z.infer<typeof printHostKindSchema>;

/** A printer as back-office sees it. Carries only the secret *prefix*, never the secret. */
export const printerAdminSummarySchema = z.object({
	id: z.string(),
	device_id: z.string(),
	name: z.string(),
	shelter_code: z.string(),
	station: z.string().nullable(),
	host_kind: printHostKindSchema,
	status: printDeviceStatusSchema,
	secret_prefix: z.string(),
	last_seen_at: z.string().nullable(),
	queue_state: printerQueueStateSchema,
	agent_version: z.string().nullable(),
	/** LAN IPs the agent reported on its last hello; empty until it first does. */
	local_ips: z.array(z.string()).default([]),
	online: z.boolean()
});
export type PrinterAdminSummary = z.infer<typeof printerAdminSummarySchema>;

export const printerLastJobSchema = z.object({
	status: z.string(),
	finished_at: z.string().nullable(),
	error_code: z.string().nullable(),
	created_at: z.string()
});

export const printerAdminItemSchema = printerAdminSummarySchema.extend({
	last_job: printerLastJobSchema.nullable()
});
export type PrinterAdminItem = z.infer<typeof printerAdminItemSchema>;

export const printerAdminListResponseSchema = z.object({
	printers: z.array(printerAdminItemSchema),
	server_time: z.string()
});
export type PrinterAdminListResponse = z.infer<typeof printerAdminListResponseSchema>;

/** Mirrors the BFF `printDeviceInputSchema` (device id `[a-z0-9-]{3,63}`). */
export const printerCreateInputSchema = z.object({
	device_id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'Device ID must match [a-z0-9-]{3,63}'),
	name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
	shelter_code: z.string().min(1),
	station: z.string().trim().nullish(),
	host_kind: printHostKindSchema
});
export type PrinterCreateInput = z.infer<typeof printerCreateInputSchema>;

export const printerPatchSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	station: z.string().trim().nullable().optional(),
	status: printDeviceStatusSchema.optional()
});
export type PrinterPatch = z.infer<typeof printerPatchSchema>;

/** `secret` is shown once — callers must not keep it past the reveal dialog. */
export const printerSecretResponseSchema = z.object({
	device: printerAdminSummarySchema,
	secret: z.string()
});
export type PrinterSecretResponse = z.infer<typeof printerSecretResponseSchema>;

export const printerTestPrintResponseSchema = z.object({
	job_id: z.string(),
	expires_at: z.string()
});
export type PrinterTestPrintResponse = z.infer<typeof printerTestPrintResponseSchema>;

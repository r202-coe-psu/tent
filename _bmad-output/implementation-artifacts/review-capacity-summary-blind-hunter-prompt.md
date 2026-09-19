# Blind Hunter Review Prompt

Invoke the `bmad-review-adversarial-general` skill on the following diff. Review without relying on the implementation author's intent beyond the stated acceptance criteria. Report only actionable findings, with file/line references and a concrete consequence.

## Stated change

Exclude `paused`, `draft`, `closed`, and `cancelled` jobs from the volunteer job-capacity KPI. Keep `open`, `almost_full`, and `full`; preserve the existing shift-level fill-rate formulas and job-board filters.

## Diff from baseline `993f808b2f2b20efe9a08f93384b547c708a3b3d`

```diff
diff --git a/frontend/src/lib/features/volunteers/domain/capacity.ts b/frontend/src/lib/features/volunteers/domain/capacity.ts
@@
+import type { JobStatus } from './job.schema';
 export type FillBucket = 'critical' | 'near' | 'met';
+export type CapacityTrackedJobStatus = Extract<JobStatus, 'open' | 'almost_full' | 'full'>;
+export const CAPACITY_TRACKED_JOB_STATUSES: ReadonlySet<CapacityTrackedJobStatus> = new Set([
+  'open', 'almost_full', 'full'
+]);
+export function isCapacityTrackedJobStatus(status: JobStatus): status is CapacityTrackedJobStatus {
+  return CAPACITY_TRACKED_JOB_STATUSES.has(status as CapacityTrackedJobStatus);
+}

diff --git a/frontend/src/lib/features/volunteers/domain/capacity.test.ts b/frontend/src/lib/features/volunteers/domain/capacity.test.ts
@@
+describe('isCapacityTrackedJobStatus', () => {
+  it('tracks capacity for open, almost_full and full jobs', () => {
+    expect(isCapacityTrackedJobStatus('open')).toBe(true);
+    expect(isCapacityTrackedJobStatus('almost_full')).toBe(true);
+    expect(isCapacityTrackedJobStatus('full')).toBe(true);
+  });
+  it('excludes paused, draft and terminal jobs from capacity tracking', () => {
+    for (const status of ['paused', 'draft', 'closed', 'cancelled'] as const) {
+      expect(isCapacityTrackedJobStatus(status)).toBe(false);
+    }
+  });
+});

diff --git a/frontend/src/lib/features/volunteers/ui/job-capacity-summary.svelte b/frontend/src/lib/features/volunteers/ui/job-capacity-summary.svelte
@@
- * Draft/closed/cancelled jobs are excluded from the capacity buckets.
+ * Paused, draft, closed and cancelled jobs are excluded from the capacity buckets.
@@
+  isCapacityTrackedJobStatus,
@@
- const capacityJobs = $derived(jobs.filter((j) => j.status !== 'draft' && j.status !== 'closed' && j.status !== 'cancelled'));
+ const capacityJobs = $derived(jobs.filter((j) => isCapacityTrackedJobStatus(j.status)));
```

Also review the new spec `spec-fix-volunteer-capacity-summary.md` and its acceptance criteria for mismatch with the code or existing project requirements.

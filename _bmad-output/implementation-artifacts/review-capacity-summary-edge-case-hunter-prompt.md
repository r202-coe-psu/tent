# Edge Case Hunter Review Prompt

Invoke the `bmad-review-edge-case-hunter` skill on the following diff. Walk every status and type boundary, including empty inputs, schema evolution, TypeScript narrowing, and any consumer that could be affected. Report only unhandled edge cases, with file/line references and expected versus actual behavior.

## Expected behavior

Capacity KPI includes only job statuses `open`, `almost_full`, and `full`. It excludes `paused`, `draft`, `closed`, and `cancelled`, while retaining shift-level bucket thresholds and existing job-board filtering behavior.

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
- const capacityJobs = $derived(jobs.filter((j) => j.status !== 'draft' && j.status !== 'closed' && j.status !== 'cancelled'));
+ const capacityJobs = $derived(jobs.filter((j) => isCapacityTrackedJobStatus(j.status)));
```

Also inspect the new spec `spec-fix-volunteer-capacity-summary.md` and compare all status cases against the project's job schema and requirements.

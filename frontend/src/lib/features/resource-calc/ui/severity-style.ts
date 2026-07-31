/**
 * T-32 — shared Thai labels + Tailwind token classes for a row {@link Severity}.
 * Uses the app's semantic tokens (`danger` / `warning` / `success`) so the dashboard
 * stays theme-aware and consistent with other back-office screens.
 */
import type { Severity } from '../domain/dashboard-view';

export const SEVERITY_LABEL: Record<Severity, string> = {
	crit: 'ต้องเร่งจัดหา',
	watch: 'เฝ้าระวัง',
	ok: 'เพียงพอ',
	constraint: 'ข้อจำกัดคุณภาพ',
	nodata: 'รอข้อมูล'
};

/** Pill/badge background + text for a severity. */
export function severityPill(s: Severity): string {
	switch (s) {
		case 'crit':
			return 'bg-danger-muted text-danger';
		case 'watch':
			return 'bg-warning-muted text-warning-subtle';
		case 'ok':
			return 'bg-success-muted text-success';
		case 'constraint':
			return 'bg-primary/10 text-primary';
		case 'nodata':
			return 'bg-muted text-muted-foreground';
	}
}

/** Solid fill (severity dot / progress bar). */
export function severityBar(s: Severity): string {
	switch (s) {
		case 'crit':
			return 'bg-danger';
		case 'watch':
			return 'bg-warning';
		case 'ok':
			return 'bg-success';
		case 'constraint':
			return 'bg-primary';
		case 'nodata':
			return 'bg-muted-foreground/30';
	}
}

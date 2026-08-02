<script lang="ts">
	/**
	 * T-32 — "วิเคราะห์ความต้องการเสบียง (Sphere Standard)" dashboard.
	 *
	 * Reads ONE day's persisted `daily_calc` snapshot (the real T-31 engine output, keyed by SOP
	 * ratios) and renders it as an operational needs board: KPI tiles (with a 14-day occupancy
	 * sparkline) + a severity-sorted table with days-of-supply. Reactivity comes from the changes
	 * feed via `useDailyCalc` — no polling.
	 */
	import { toast } from 'svelte-sonner';
	import Users from '@lucide/svelte/icons/users';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Eye from '@lucide/svelte/icons/eye';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import FileDown from '@lucide/svelte/icons/file-down';
	import Scale from '@lucide/svelte/icons/scale';
	import { RATIO_LABELS } from '$lib/features/sop-ratios';
	import type { SopRatioKey } from '$lib/features/sop-ratios';
	import { useDailyCalc } from '../application/use-daily-calc';
	import { useCalcRange } from '../application/use-calc-range';
	import {
		daysOfSupply,
		rowSeverity,
		sortBySeverity,
		summarizeStatuses
	} from '../domain/dashboard-view';
	import type { Severity } from '../domain/dashboard-view';
	import { CATEGORY_LABELS, categoryOf, type ResourceCategory } from './sop-category';
	import { SEVERITY_LABEL, severityBar } from './severity-style';
	import CalcStatusBadge from './calc-status-badge.svelte';
	import ResourceNeedsTable from './resource-needs-table.svelte';

	/** Today's calendar date (local), `YYYY-MM-DD`. */
	function todayLocal(): string {
		const d = new Date();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${mm}-${dd}`;
	}
	/** Shift an ISO date by `days` (timezone-safe, local). */
	function addDays(iso: string, days: number): string {
		const [y, m, d] = iso.split('-').map(Number);
		const dt = new Date(y, m - 1, d + days);
		const mm = String(dt.getMonth() + 1).padStart(2, '0');
		const dd = String(dt.getDate()).padStart(2, '0');
		return `${dt.getFullYear()}-${mm}-${dd}`;
	}

	let date = $state(todayLocal());
	let category = $state<'all' | ResourceCategory>('all');
	let status = $state<'all' | Severity>('all');
	let search = $state('');

	const record = useDailyCalc(() => date);
	const snapshot = $derived(record.data);
	const results = $derived(snapshot?.results ?? []);

	// 14-day occupancy trend for the KPI sparkline (bounded range scan — not the full trend view).
	const from14 = $derived(addDays(date, -13));
	const range = useCalcRange(
		() => from14,
		() => date
	);
	const occTrend = $derived((range.data ?? []).map((r) => r.occupancy_snapshot));

	const summary = $derived(summarizeStatuses(results));
	const occupancy = $derived(snapshot?.occupancy_snapshot ?? 0);

	const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
	const labelOf = (key: string) => RATIO_LABELS[key as SopRatioKey]?.label ?? key;

	// ─── Sparkline geometry ─────────────────────────────────────────────────────
	const SPARK_W = 96;
	const SPARK_H = 34;
	const spark = $derived.by(() => {
		const vals = occTrend;
		if (vals.length < 2) return null;
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		const span = max - min || 1;
		const px = (i: number) => (i / (vals.length - 1)) * (SPARK_W - 4) + 2;
		const py = (v: number) => SPARK_H - 4 - ((v - min) / span) * (SPARK_H - 10);
		const pts = vals.map((v, i) => [px(i), py(v)] as const);
		const line = pts
			.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
			.join(' ');
		const area =
			`M${pts[0][0].toFixed(1)} ${SPARK_H}` +
			pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') +
			`L${pts[pts.length - 1][0].toFixed(1)} ${SPARK_H}Z`;
		return { line, area, last: pts[pts.length - 1] };
	});

	// ─── Filtering ──────────────────────────────────────────────────────────────
	const filtered = $derived(
		results.filter((r) => {
			if (category !== 'all' && categoryOf(r.key) !== category) return false;
			if (status !== 'all' && rowSeverity(r) !== status) return false;
			const q = search.trim().toLowerCase();
			if (q && !labelOf(r.key).toLowerCase().includes(q) && !r.key.toLowerCase().includes(q))
				return false;
			return true;
		})
	);
	const sorted = $derived(sortBySeverity(filtered));
	const critLabels = $derived(
		sortBySeverity(results.filter((r) => rowSeverity(r) === 'crit')).map((r) => labelOf(r.key))
	);

	// counts for the filter chips / segments
	const catCounts = $derived.by(() => {
		const m = {} as Record<ResourceCategory, number>;
		for (const r of results) {
			const c = categoryOf(r.key);
			m[c] = (m[c] ?? 0) + 1;
		}
		return m;
	});
	const cats = $derived(
		(Object.keys(CATEGORY_LABELS) as ResourceCategory[]).filter((c) => (catCounts[c] ?? 0) > 0)
	);
	const sevOrder: Severity[] = ['crit', 'watch', 'ok', 'constraint', 'nodata'];

	// ─── KPI tiles ──────────────────────────────────────────────────────────────
	const kpis = $derived([
		{
			key: 'occ',
			label: 'ยอดผู้พักพิง',
			value: occupancy,
			unit: 'คน',
			icon: Users,
			tint: 'primary',
			foot: '14 วันล่าสุด',
			spark: true
		},
		{
			key: 'crit',
			label: 'ต้องเร่งจัดหา',
			value: summary.crit,
			unit: 'รายการ',
			icon: AlertTriangle,
			tint: 'danger',
			foot: 'คงเหลือ < 3 วัน / ขาดมาก',
			spark: false
		},
		{
			key: 'watch',
			label: 'เฝ้าระวัง',
			value: summary.watch,
			unit: 'รายการ',
			icon: Eye,
			tint: 'warning',
			foot: 'คงเหลือ 3–7 วัน',
			spark: false
		},
		{
			key: 'ok',
			label: 'เพียงพอ',
			value: summary.ok,
			unit: 'รายการ',
			icon: CheckCircle2,
			tint: 'success',
			foot: `+ รอ sync ${summary.nodata} · มาตรฐาน ${summary.constraint}`,
			spark: false
		}
	] as const);

	const tileClass: Record<string, string> = {
		primary: 'from-primary/5 [&_.ic]:border-primary/20 [&_.ic]:bg-primary/10 [&_.ic]:text-primary',
		danger: 'from-danger/5 [&_.ic]:border-danger/20 [&_.ic]:bg-danger-muted [&_.ic]:text-danger',
		warning:
			'from-warning/5 [&_.ic]:border-warning/20 [&_.ic]:bg-warning-muted [&_.ic]:text-warning-subtle',
		success:
			'from-success/5 [&_.ic]:border-success/20 [&_.ic]:bg-success-muted [&_.ic]:text-success'
	};
	const valueClass = $derived<Record<string, string>>({
		primary: 'text-foreground',
		danger: summary.crit > 0 ? 'text-danger' : 'text-foreground',
		warning: summary.watch > 0 ? 'text-warning-subtle' : 'text-foreground',
		success: 'text-foreground'
	});
	const sparkColor: Record<string, string> = {
		primary: 'text-primary',
		danger: 'text-danger',
		warning: 'text-warning',
		success: 'text-success'
	};

	// active/idle classes for a filter chip
	const chip = (active: boolean) =>
		active
			? 'border-primary/40 bg-primary/10 text-primary'
			: 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground';

	function exportCsv() {
		if (sorted.length === 0) {
			toast.error('ไม่มีรายการให้ส่งออก');
			return;
		}
		const head = ['หมวดหมู่', 'รายการ', 'เป้าหมาย/วัน', 'หน่วย', 'สต็อก', 'วันคงเหลือ', 'สถานะ'];
		const rows = sorted.map((r) => {
			const dos = daysOfSupply(r);
			return [
				CATEGORY_LABELS[categoryOf(r.key)],
				labelOf(r.key),
				r.need ?? '',
				RATIO_LABELS[r.key as SopRatioKey]?.unit ?? '',
				r.have ?? '',
				dos != null ? dos.toFixed(1) : '',
				SEVERITY_LABEL[rowSeverity(r)]
			];
		});
		const csv = [head, ...rows]
			.map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\r\n');
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `resource-needs-${date}.csv`;
		a.rel = 'noopener';
		// Some browsers (Firefox) only fire the download when the anchor is in the DOM,
		// and revoking the blob URL synchronously can abort the download — defer it.
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		toast.success('ส่งออกรายงานแล้ว');
	}
</script>

<div class="flex w-full flex-col gap-6 p-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
		<div>
			<h2 class="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
				<Scale class="h-7 w-7 text-primary" />
				วิเคราะห์ความต้องการเสบียง
			</h2>
			<p class="mt-1.5 max-w-2xl text-sm text-muted-foreground">
				ประเมินความต้องการทรัพยากรตามมาตรฐาน Sphere แบบรายวัน — คำนวณจากยอดผู้พักพิงและอัตราส่วน SOP
			</p>
			<div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
				<label class="flex items-center gap-1.5 text-muted-foreground">
					วันที่
					<input
						type="date"
						bind:value={date}
						class="rounded-lg border border-border bg-background px-2 py-1 text-foreground"
					/>
				</label>
				{#if snapshot}
					<span class="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
						สูตร {snapshot.formula_v}
					</span>
					<span class="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
						SOP v{snapshot.sop_profile_version}
					</span>
					<span class="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
						ผู้พักพิง {nf.format(occupancy)} คน
					</span>
				{/if}
			</div>
		</div>
		<CalcStatusBadge {date} />
	</div>

	{#if record.isPending}
		<p class="py-16 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล…</p>
	{:else if record.isError}
		<p class="py-16 text-center text-sm text-danger">
			โหลดข้อมูลไม่สำเร็จ: {record.error?.message}
		</p>
	{:else if !snapshot}
		<div
			class="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-16 text-center text-sm text-muted-foreground"
		>
			ยังไม่มีผลคำนวณสำหรับวันที่ {date} — กดปุ่ม "คำนวณใหม่" ด้านบนเพื่อสร้างสแนปช็อต
		</div>
	{:else}
		<!-- KPI tiles -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each kpis as k (k.key)}
				<div
					class="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br via-background to-card p-5 shadow-sm {tileClass[
						k.tint
					]}"
				>
					<div class="flex items-start justify-between">
						<span class="block text-xs font-bold tracking-wider text-muted-foreground uppercase">
							{k.label}
						</span>
						<div class="ic rounded-xl border p-2.5">
							<k.icon class="h-4.5 w-4.5" />
						</div>
					</div>
					<div class="mt-2 flex items-end gap-1">
						<strong class="font-mono text-3xl font-extrabold {valueClass[k.tint]}">
							{nf.format(k.value)}
						</strong>
						<small class="mb-1 text-xs text-muted-foreground">{k.unit}</small>
					</div>
					<div class="mt-1 flex items-end justify-between gap-2">
						<span class="text-[11px] text-muted-foreground">{k.foot}</span>
						{#if k.spark && spark}
							<svg
								class="h-8 w-24 shrink-0 {sparkColor[k.tint]}"
								viewBox="0 0 {SPARK_W} {SPARK_H}"
								preserveAspectRatio="none"
								aria-hidden="true"
							>
								<path d={spark.area} fill="currentColor" class="opacity-15" />
								<path
									d={spark.line}
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linejoin="round"
									stroke-linecap="round"
								/>
								<circle
									cx={spark.last[0].toFixed(1)}
									cy={spark.last[1].toFixed(1)}
									r="2.4"
									fill="currentColor"
								/>
							</svg>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- Urgent callout -->
		{#if critLabels.length > 0}
			<div
				class="flex items-start gap-3 rounded-2xl border border-danger-border bg-danger-muted px-4 py-3"
			>
				<AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-danger" />
				<div class="text-sm">
					<span class="font-bold text-danger">ต้องเร่งจัดหา {critLabels.length} รายการ:</span>
					<span class="text-foreground">{critLabels.slice(0, 5).join(' · ')}</span>
					{#if critLabels.length > 5}
						<span class="text-muted-foreground">และอีก {critLabels.length - 5} รายการ</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Toolbar -->
		<div class="flex flex-col gap-3">
			<!-- category chips -->
			<div class="flex flex-wrap items-center gap-1.5">
				<button
					type="button"
					onclick={() => (category = 'all')}
					class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {chip(
						category === 'all'
					)}"
				>
					ทุกหมวดหมู่
					<span class="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
						{results.length}
					</span>
				</button>
				{#each cats as c (c)}
					<button
						type="button"
						onclick={() => (category = c)}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {chip(
							category === c
						)}"
					>
						{CATEGORY_LABELS[c]}
						<span class="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
							{catCounts[c]}
						</span>
					</button>
				{/each}
			</div>

			<!-- status segments + search + export -->
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex flex-wrap items-center gap-1">
					<button
						type="button"
						onclick={() => (status = 'all')}
						class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors {chip(
							status === 'all'
						)}"
					>
						ทุกสถานะ
					</button>
					{#each sevOrder as s (s)}
						<button
							type="button"
							onclick={() => (status = s)}
							class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors {chip(
								status === s
							)}"
						>
							<span class="h-2 w-2 rounded-full {severityBar(s)}"></span>
							{SEVERITY_LABEL[s]}
							<span class="text-[10px] text-muted-foreground">{summary[s]}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<input
						type="search"
						bind:value={search}
						placeholder="ค้นหารายการ…"
						class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
					/>
					<button
						type="button"
						onclick={exportCsv}
						class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						<FileDown class="h-4 w-4" /> ส่งออกรายงาน
					</button>
				</div>
			</div>
		</div>

		<ResourceNeedsTable rows={sorted} />
	{/if}
</div>

<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import { Button } from '$lib/components/ui/button/index.js';
	import { screenTypeOf } from '$lib/features/shared/domain/kiosk-screen';
	import { isActiveAt } from '../domain/kiosk-banner';
	import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
	import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
	import { moveItem } from './kiosk-banner-order';
	import { SortableDrag } from './kiosk-banner-sortable.svelte';
	import { formatBannerWindow } from './kiosk-banner-window';

	/**
	 * Draft-order list of one screen type's banners for the reorder page. Rows reorder by dragging
	 * the handle (mouse and touch) or with the ↑ / ↓ buttons; `items` is reassigned, never mutated.
	 */
	let {
		items = $bindable(),
		now,
		disabled = false,
		rowActions
	}: {
		items: KioskBannerSummary[];
		now: Date;
		disabled?: boolean;
		rowActions?: Snippet<[KioskBannerSummary]>;
	} = $props();

	const statusOf = (banner: KioskBannerSummary) =>
		isActiveAt(banner, now)
			? {
					label: 'แสดงอยู่',
					class:
						'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900'
				}
			: banner.status === 'inactive'
				? { label: 'ปิดอยู่', class: 'badge-muted' }
				: { label: 'รอแสดง', class: 'badge-accent' };

	let announcement = $state('');

	/** Moves the row at `from` to final index `to` and announces the new position. */
	function move(from: number, to: number) {
		if (from === to) return;
		const title = items[from].title;
		items = moveItem(items, from, to);
		announcement = `ย้าย ${title} ไปลำดับ ${to + 1}`;
	}

	let listEl = $state<HTMLOListElement>();

	/**
	 * Moves a row with an arrow button, then keeps keyboard focus on that row's arrow (the keyed
	 * `<li>` is relocated, which drops focus); falls back to the other arrow when it is now disabled.
	 */
	async function moveWithArrow(banner: KioskBannerSummary, index: number, dir: 'up' | 'down') {
		move(index, dir === 'up' ? index - 1 : index + 1);
		await tick();
		const arrowOf = (which: string) =>
			[...(listEl?.querySelectorAll<HTMLButtonElement>('button[data-move]') ?? [])].find(
				(button) => button.dataset.bannerId === banner._id && button.dataset.move === which
			);
		const same = arrowOf(dir);
		(same && !same.disabled ? same : arrowOf(dir === 'up' ? 'down' : 'up'))?.focus();
	}

	const drag = new SortableDrag(move);
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && drag.cancel()} />

{#if items.length === 0}
	<p class="px-6 py-12 text-center text-muted-foreground">
		ไม่มีแบนเนอร์ที่ยังไม่หมดอายุสำหรับขนาดจอนี้
	</p>
{:else}
	<ol bind:this={listEl} class="divide-y divide-border/60">
		{#each items as banner, index (banner._id)}
			{@const status = statusOf(banner)}
			<li
				class={[
					'relative flex flex-wrap items-center gap-3 bg-white px-4 py-3 sm:px-6',
					drag.from === index && 'z-10 opacity-90 shadow-md',
					drag.active &&
						drag.from !== index &&
						'motion-safe:transition-transform motion-safe:duration-150'
				]}
				style={drag.rowStyle(index)}
			>
				<Button
					variant="ghost"
					size="sm"
					class="min-h-11 min-w-11 cursor-grab touch-none p-0 active:cursor-grabbing"
					aria-label="ลากเพื่อย้าย {banner.title}"
					{disabled}
					onpointerdown={(event) => !disabled && drag.start(event, index)}
					onpointermove={(event) => drag.move(event)}
					onpointerup={() => drag.end()}
					onpointercancel={() => drag.cancel()}
				>
					<GripVertical class="h-4 w-4" />
				</Button>
				<span
					data-testid="position"
					class="w-6 text-center font-semibold text-slate-700 tabular-nums">{index + 1}</span
				>
				<img
					src={kioskBannerRemoteRepository.imageUrl(banner._id, banner._rev)}
					alt=""
					class={[
						'shrink-0 rounded-md border border-border bg-slate-100 object-contain',
						screenTypeOf(banner) === 'portrait' ? 'h-16 w-9' : 'h-12 w-20'
					]}
					loading="lazy"
				/>
				<div class="min-w-0 flex-1 basis-48">
					<p class="truncate font-semibold text-foreground">{banner.title}</p>
					<p class="text-sm whitespace-nowrap text-slate-700 tabular-nums">
						{formatBannerWindow(banner.start_at, banner.end_at)}
					</p>
				</div>
				<span class={status.class}>{status.label}</span>
				<div class="ml-auto flex flex-wrap items-center justify-end gap-1">
					{@render rowActions?.(banner)}
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 min-w-11 p-0"
						aria-label="เลื่อน {banner.title} ขึ้น"
						data-move="up"
						data-banner-id={banner._id}
						disabled={disabled || index === 0}
						onclick={() => moveWithArrow(banner, index, 'up')}
					>
						<ArrowUp class="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-11 min-w-11 p-0"
						aria-label="เลื่อน {banner.title} ลง"
						data-move="down"
						data-banner-id={banner._id}
						disabled={disabled || index === items.length - 1}
						onclick={() => moveWithArrow(banner, index, 'down')}
					>
						<ArrowDown class="h-4 w-4" />
					</Button>
				</div>
			</li>
		{/each}
	</ol>
{/if}

<div class="sr-only" aria-live="polite">{announcement}</div>

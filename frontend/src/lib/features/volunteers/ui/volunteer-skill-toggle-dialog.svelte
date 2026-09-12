<script lang="ts">
	import type { MasterDataItem } from '$lib/features/master-data';
	import { Button } from '$lib/components/ui/button/index.js';
	import Power from '@lucide/svelte/icons/power';

	let { open, item, onClose, onConfirm } = $props<{
		open: boolean;
		item: MasterDataItem | null;
		onClose: () => void;
		onConfirm: () => Promise<void>;
	}>();

	const isCurrentlyActive = $derived(item?.status !== 'inactive');
</script>

{#if open && item}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-md animate-in overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl duration-150 zoom-in-95 fade-in"
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {isCurrentlyActive
						? 'bg-warning/15 text-warning-foreground'
						: 'bg-success/15 text-success'}"
				>
					<Power class="h-5 w-5" />
				</div>
				<div>
					<h3 class="text-base font-bold text-foreground">
						{isCurrentlyActive ? 'ยืนยันการปิดใช้งานทักษะ' : 'ยืนยันการเปิดใช้งานทักษะ'}
					</h3>
					<p class="text-xs text-muted-foreground">การปรับเปลี่ยนสถานะการใช้งานในระบบ</p>
				</div>
			</div>

			<div
				class="space-y-2 rounded-xl border border-border/80 bg-muted/40 p-4 text-xs leading-relaxed text-foreground"
			>
				<p>
					คุณต้องการ{isCurrentlyActive ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}ทักษะ
					<span class="font-bold">{item.label}</span>
					(<code class="font-mono font-semibold">{item.code}</code>) ใช่หรือไม่?
				</p>
				<p class="text-muted-foreground">
					{#if isCurrentlyActive}
						⚠️ เมื่อปิดใช้งาน ทักษะนี้จะไม่แสดงให้เลือกในฟอร์มประกาศงานอาสาและหน้าลงทะเบียน
					{:else}
						✅ เมื่อเปิดใช้งาน ทักษะนี้จะกลับมาแสดงให้เลือกในระบบตามปกติ
					{/if}
				</p>
			</div>

			<div class="mt-6 flex items-center justify-end gap-2.5">
				<Button
					type="button"
					variant="outline"
					class="rounded-xl border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted"
					onclick={onClose}
				>
					ยกเลิก
				</Button>
				<Button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs {isCurrentlyActive
						? 'bg-warning text-warning-foreground hover:bg-warning/90'
						: 'bg-success text-success-foreground hover:bg-success/90'}"
					onclick={onConfirm}
				>
					<Power class="h-3.5 w-3.5" />
					{isCurrentlyActive ? 'ยืนยันปิดใช้งาน' : 'ยืนยันเปิดใช้งาน'}
				</Button>
			</div>
		</div>
	</div>
{/if}

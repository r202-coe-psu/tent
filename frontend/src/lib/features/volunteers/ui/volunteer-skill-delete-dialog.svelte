<script lang="ts">
	import type { MasterDataItem } from '$lib/features/master-data';
	import { Button } from '$lib/components/ui/button/index.js';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { open, item, onClose, onConfirm } = $props<{
		open: boolean;
		item: MasterDataItem | null;
		onClose: () => void;
		onConfirm: () => Promise<void>;
	}>();
</script>

{#if open && item}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-md animate-in overflow-hidden rounded-2xl border border-danger/30 bg-card p-6 shadow-2xl duration-150 zoom-in-95 fade-in"
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger"
				>
					<Trash2 class="h-5 w-5" />
				</div>
				<div>
					<h3 class="text-base font-bold text-foreground">ยืนยันการลบทักษะมาตรฐาน</h3>
					<p class="text-xs text-muted-foreground">การดำเนินการนี้ไม่สามารถย้อนกลับได้</p>
				</div>
			</div>

			<div
				class="space-y-3 rounded-xl border border-border/80 bg-muted/40 p-4 text-xs leading-relaxed text-foreground"
			>
				<p>
					คุณแน่ใจหรือไม่ว่าต้องการลบทักษะ <span class="font-bold text-danger">"{item.label}"</span>
					(รหัส <code class="font-mono font-semibold">{item.code}</code>) ออกจากระบบ Master Data?
				</p>
				<p class="text-muted-foreground">⚠️ ทักษะนี้จะถูกนำออกจากรายการ Master Data ทันที</p>
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
					variant="destructive"
					class="inline-flex items-center gap-1.5 rounded-xl bg-danger px-4 py-2 text-xs font-bold text-danger-foreground shadow-xs hover:bg-danger/90"
					onclick={onConfirm}
				>
					<Trash2 class="h-3.5 w-3.5" />
					ยืนยันการลบ
				</Button>
			</div>
		</div>
	</div>
{/if}

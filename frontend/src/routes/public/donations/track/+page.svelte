<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	let tokenInput = $state('');
	function handleSearch(type: 'track' | 'cancel') {
		const cleanToken = tokenInput.trim();
		if (!cleanToken) {
			toast.error('กรุณาระบุรหัสติดตามสิ่งของบริจาค (Tracking Token)');
			return;
		}
		if (type === 'cancel') {
			// Navigate to track detail with a cancel query param to auto-trigger cancel dialog
			goto(resolve(`/public/donations/track/${encodeURIComponent(cleanToken)}?action=cancel`));
		} else {
			goto(resolve(`/public/donations/track/${encodeURIComponent(cleanToken)}`));
		}
	}
</script>

<svelte:head>
	<title>ติดตามสถานะของบริจาค — Smart Shelter</title>
</svelte:head>
<div class="mx-auto max-w-2xl px-4 py-8 md:py-16">
	<!-- Back link -->
	<a
		href={resolve('/public/donations')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground md:mb-8"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		กลับหน้าจองคิวบริจาค
	</a>
	<!-- Tracking Form Card -->
	<div
		class="overflow-hidden rounded-3xl border border-border bg-card p-6 text-foreground shadow-2xl md:p-10"
	>
		<div class="mb-6 flex items-center gap-3">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"
			>
				<QrCode class="h-5 w-5" />
			</div>
			<div>
				<h1 class="text-lg font-bold tracking-tight md:text-xl">ติดตามสถานะสิ่งของบริจาค</h1>
				<p class="mt-0.5 text-xs text-muted-foreground">
					กรอกรหัสติดตามสิ่งของบริจาค เพื่อดูสถานะการส่งมอบ หรือดำเนินการยกเลิกคำขอ
				</p>
			</div>
		</div>
		<div class="space-y-5">
			<div class="space-y-2">
				<label
					for="token-field"
					class="block text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase"
				>
					รหัสติดตามสิ่งของบริจาค (Tracking Token)
				</label>
				<Input
					id="token-field"
					type="text"
					placeholder="เช่น DN-582910 หรือ RQ-9901"
					bind:value={tokenInput}
					class="h-12 w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				/>
			</div>
			<div class="flex flex-col gap-3 pt-2 sm:flex-row">
				<Button
					onclick={() => handleSearch('track')}
					class="inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
				>
					<Search class="h-4 w-4" />
					ติดตามสถานะ (Track Status)
				</Button>
				<Button
					onclick={() => handleSearch('cancel')}
					variant="outline"
					class="inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-red-200 px-5 py-3 text-sm font-bold text-red-600 transition-all hover:bg-red-50 dark:hover:bg-red-950/20"
				>
					<Trash2 class="h-4 w-4" />
					ยกเลิกการบริจาค (Cancel Booking)
				</Button>
			</div>
		</div>
		<!-- Mock Guide Info Box -->
		<div class="mt-8 space-y-3 border-t border-border/60 pt-6">
			<div class="flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground">
				<AlertCircle class="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-500" />
				<div>
					<span class="font-bold text-foreground"
						>รหัสสำหรับการจำลองทดสอบระบบ (Mock Tracking Tokens):</span
					>
					<div class="mt-2 grid grid-cols-1 gap-2 font-mono sm:grid-cols-2">
						<button
							onclick={() => (tokenInput = 'DN-582910')}
							class="group cursor-pointer rounded-lg border border-border/30 bg-muted/50 p-2 text-left transition-all hover:border-primary hover:bg-muted/80"
						>
							<div
								class="text-[10px] font-bold text-blue-600 group-hover:underline dark:text-blue-400"
							>
								DN-582910
							</div>
							<div class="mt-0.5 text-[9px] text-muted-foreground">สถานะ: จองแล้ว (Declared)</div>
						</button>
						<button
							onclick={() => (tokenInput = 'RQ-9901')}
							class="group cursor-pointer rounded-lg border border-border/30 bg-muted/50 p-2 text-left transition-all hover:border-primary hover:bg-muted/80"
						>
							<div
								class="text-[10px] font-bold text-amber-600 group-hover:underline dark:text-amber-400"
							>
								RQ-9901
							</div>
							<div class="mt-0.5 text-[9px] text-muted-foreground">
								สถานะ: รอตรวจสอบความเหมาะสม (Pending)
							</div>
						</button>
						<button
							onclick={() => (tokenInput = 'DN-111111')}
							class="group cursor-pointer rounded-lg border border-border/30 bg-muted/50 p-2 text-left transition-all hover:border-primary hover:bg-muted/80"
						>
							<div
								class="text-[10px] font-bold text-emerald-600 group-hover:underline dark:text-emerald-400"
							>
								DN-111111
							</div>
							<div class="mt-0.5 text-[9px] text-muted-foreground">
								สถานะ: รับเข้าคลังแล้ว (Received)
							</div>
						</button>
						<button
							onclick={() => (tokenInput = 'DN-222222')}
							class="group cursor-pointer rounded-lg border border-border/30 bg-muted/50 p-2 text-left transition-all hover:border-primary hover:bg-muted/80"
						>
							<div class="text-[10px] font-bold text-zinc-500 group-hover:underline">DN-222222</div>
							<div class="mt-0.5 text-[9px] text-muted-foreground">
								สถานะ: ยกเลิกแล้ว (Cancelled)
							</div>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

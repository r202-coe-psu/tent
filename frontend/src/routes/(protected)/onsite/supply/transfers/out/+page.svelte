<script lang="ts">
	import { TransferForm } from '$lib/features/operations';
	import { goto } from '$app/navigation';
</script>

<div class="container mx-auto max-w-3xl py-6 px-4">
	<div class="mb-6 space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-foreground">โอนย้ายพัสดุออก</h1>
		<p class="text-sm font-medium text-muted-foreground">
			สร้างรายการโอนย้าย และตัดสต็อกออกจากคลังปัจจุบัน (Outbound Transfer)
		</p>
	</div>

	<div class="w-full">
		<TransferForm
			onsuccess={() => {
				goto('/onsite/supply/transfers/out', { replaceState: true });
			}}
		/>
	</div>
</div>

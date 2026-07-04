<script lang="ts">
	import { IncomingTransferList } from '$lib/features/operations';
</script>

<div class="container mx-auto max-w-4xl py-6 px-4">
	<div class="mb-6 space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-foreground">รับพัสดุโอนเข้า (In-Transit)</h1>
		<p class="text-sm font-medium text-muted-foreground">
			รายการพัสดุที่ถูกจัดส่งมาจากศูนย์อื่นและรอการตรวจสอบเพื่อนำเข้าคลัง
		</p>
	</div>

	<div class="w-full">
		<IncomingTransferList />
	</div>
</div>

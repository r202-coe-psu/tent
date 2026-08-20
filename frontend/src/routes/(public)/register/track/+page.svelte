<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import PackageSearch from '@lucide/svelte/icons/package-search';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { BookingTicket, useBookingLookup } from '$lib/features/public-register';

	const lookup = useBookingLookup();

	let code = $state('');
	let phone = $state('');
	let errorMessage = $state('');

	const ticket = $derived(lookup.data ?? null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		if (!code.trim() || !phone.trim()) {
			errorMessage = 'กรุณากรอกรหัสการจองและเบอร์โทรศัพท์';
			return;
		}

		try {
			await lookup.mutateAsync({ code: code.trim(), phone: phone.trim() });
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'ตรวจสอบสถานะไม่สำเร็จ';
			toast.error(errorMessage);
		}
	}
</script>

<svelte:head>
	<title>ตรวจสอบสถานะการจอง — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-6">
	<div class="mx-auto w-full max-w-md space-y-6">
		<div class="text-center">
			<div
				class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-muted text-primary"
			>
				<PackageSearch class="h-6 w-6" />
			</div>
			<h1 class="mt-3 text-xl font-bold text-foreground">ตรวจสอบสถานะการจอง</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				กรอกรหัสการจองที่อยู่บนใบจอง คู่กับเบอร์โทรศัพท์ที่ใช้ตอนจอง
			</p>
		</div>

		<form
			onsubmit={submit}
			class="space-y-4 rounded-2xl border border-black/[0.04] bg-card p-5 shadow-sm"
		>
			<div class="space-y-2">
				<Label for="booking-code">รหัสการจอง</Label>
				<Input
					id="booking-code"
					bind:value={code}
					placeholder="เช่น 01JABCDEFGHJKMNPQRSTVWXYZ0"
					autocomplete="off"
					class="font-mono"
				/>
			</div>

			<div class="space-y-2">
				<Label for="booking-phone">เบอร์โทรศัพท์</Label>
				<Input
					id="booking-phone"
					bind:value={phone}
					inputmode="numeric"
					maxlength={10}
					placeholder="0812345678"
					autocomplete="tel"
				/>
			</div>

			{#if errorMessage}
				<p
					class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
					role="alert"
				>
					{errorMessage}
				</p>
			{/if}

			<Button type="submit" class="w-full" disabled={lookup.isPending}>
				{lookup.isPending ? 'กำลังตรวจสอบ…' : 'ตรวจสอบสถานะ'}
			</Button>

			<p class="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
				<Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>
					<span class="font-semibold">ทำไมต้องใส่เบอร์ด้วย?</span>
					เพื่อป้องกันไม่ให้ผู้อื่นสุ่มรหัสแล้วเห็นข้อมูลการจองของท่าน ระบบจึงต้องการทั้งรหัสและเบอร์โทรที่ตรงกัน
				</span>
			</p>
		</form>

		{#if ticket}
			<BookingTicket {ticket} showSuccessHeader={false} />
		{/if}
	</div>
</PublicPageShell>

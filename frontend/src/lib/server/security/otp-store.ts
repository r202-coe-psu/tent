interface OtpEntry {
	code: string;
	expiresAt: number;
}

class OtpStore {
	private store = new Map<string, OtpEntry>();
	private expiryMs = 5 * 60 * 1000; // 5 minutes

	generateAndStore(phone: string): string {
		// Mock OTP generation: random 6 digits
		const code = Math.floor(100000 + Math.random() * 900000).toString();
		const expiresAt = Date.now() + this.expiryMs;
		
		this.store.set(phone, { code, expiresAt });
		
		// In a real app, you would send this code via SMS here
		// For now, we mock it by logging
		console.log(`\n[MOCK SMS] 📱 ส่ง OTP รหัส: ${code} ไปยังเบอร์: ${phone} (หมดอายุใน 5 นาที)\n`);

		return code;
	}

	verify(phone: string, code: string): boolean {
		const entry = this.store.get(phone);
		if (!entry) return false;

		if (Date.now() > entry.expiresAt) {
			this.store.delete(phone);
			return false;
		}

		if (entry.code === code) {
			this.store.delete(phone); // Burn after successful use
			return true;
		}

		return false;
	}
}

export const otpStore = new OtpStore();

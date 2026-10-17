async function loadQrcode() {
	const qrcodeModule = await import('qrcode');
	return qrcodeModule.default || qrcodeModule;
}

/** Modules per side (21 for version 1, 29 for version 3, …) of the QR `text` encodes to. */
export async function qrModuleCount(text: string): Promise<number> {
	const QRCode = await loadQrcode();
	return QRCode.create(text, {}).modules.size;
}

/** Safely generate QR Code Data URL on browser without breaking SSR. */
export async function generateQrDataUrl(
	text: string,
	options: {
		width?: number;
		margin?: number;
		color?: { dark?: string; light?: string };
	} = {}
): Promise<string> {
	if (typeof window === 'undefined' || !text) return '';
	const QRCode = await loadQrcode();
	return QRCode.toDataURL(text, {
		width: options.width ?? 256,
		margin: options.margin ?? 1,
		color: options.color ?? { dark: '#000000', light: '#ffffff' }
	});
}

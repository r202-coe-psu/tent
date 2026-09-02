/**
 * Safely generate QR Code Data URL on browser without breaking SSR.
 */
export async function generateQrDataUrl(
	text: string,
	options: {
		width?: number;
		margin?: number;
		color?: { dark?: string; light?: string };
	} = {}
): Promise<string> {
	if (typeof window === 'undefined' || !text) return '';
	const qrcodeModule = await import('qrcode');
	const QRCode = qrcodeModule.default || qrcodeModule;
	return QRCode.toDataURL(text, {
		width: options.width ?? 256,
		margin: options.margin ?? 1,
		color: options.color ?? { dark: '#000000', light: '#ffffff' }
	});
}

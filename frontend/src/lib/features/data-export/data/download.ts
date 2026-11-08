/** Hand a Blob to the browser as a file download. */
export function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	// Revoke after the click is handled: some browsers cancel the download if it is immediate.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

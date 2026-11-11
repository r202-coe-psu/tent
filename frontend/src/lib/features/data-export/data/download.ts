/** Hand a Blob to the browser as a file download. */
export function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	// Firefox needs the anchor in the DOM; remove it again after the click.
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoke after the click is handled: some browsers cancel the download if it is immediate.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

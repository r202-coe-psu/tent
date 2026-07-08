export interface DataChangeEvent {
	db: string;
	docType: string;
	docId: string;
}

type DataChangeListener = (event: DataChangeEvent) => void;

/** Canonical app-level event channel for near-real-time data invalidation (CR-033). */
class EventChannel {
	private listeners = new Set<DataChangeListener>();

	subscribe(listener: DataChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event: DataChangeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export const eventChannel = new EventChannel();

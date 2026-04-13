import { writable } from 'svelte/store';

// Increment to signal that data views should re-fetch.
// Any component that mutates data (FactSheet, BuildTracker add form, etc.)
// should call refreshData() after a successful mutation.
export const refreshCounter = writable(0);

export function refreshData() {
	refreshCounter.update(n => n + 1);
}

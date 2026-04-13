let selectedEntity = $state<{ type: 'device' | 'vlan' | 'build'; id: number } | null>(null);
let factSheetOpen = $state(false);

export function openFactSheet(type: 'device' | 'vlan' | 'build', id: number) {
	selectedEntity = { type, id };
	factSheetOpen = true;
}

export function closeFactSheet() {
	factSheetOpen = false;
	selectedEntity = null;
}

export function getSelectedEntity() {
	return selectedEntity;
}

export function isFactSheetOpen() {
	return factSheetOpen;
}

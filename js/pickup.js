import { getLoadedObjects, markObjectRemoved, getObjectSaveKey } from './mapLoader.js';

export function checkPickups(cameraContainer, scene) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(cameraContainer.position.x, 1.6, cameraContainer.position.z),
        new THREE.Vector3(0.5, 1.6, 0.5)
    );

    const objects = getLoadedObjects();

    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        const rules = obj.userData.rules || {};
        if (rules.pickup) {
            const box = new THREE.Box3().setFromObject(obj);
            if (playerBox.intersectsBox(box)) {
                const saveKey = getObjectSaveKey(obj);
                markObjectRemoved(obj);
                alert(`Picked up: ${obj.userData.type}`);
                if (saveKey && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('gameObjectRemoved', { detail: { saveKey } }));
                }
            }
        }
    }
}

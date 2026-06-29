import { getLoadedObjects, markObjectRemoved, getObjectSaveKey } from './mapLoader.js';

const fallbackPickupBox = new THREE.Box3();

function getPickupBox(obj) {
    const ud = obj && obj.userData;
    const cached = ud && ud._bbox;
    if (
        cached instanceof THREE.Box3 &&
        ud._bboxPos instanceof THREE.Vector3 &&
        ud._bboxQuat instanceof THREE.Quaternion &&
        ud._bboxScale instanceof THREE.Vector3 &&
        ud._bboxPos.equals(obj.position) &&
        ud._bboxQuat.equals(obj.quaternion) &&
        ud._bboxScale.equals(obj.scale)
    ) {
        return cached;
    }

    return fallbackPickupBox.setFromObject(obj);
}

export function checkPickups(cameraContainer, scene) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(cameraContainer.position.x, 1.6, cameraContainer.position.z),
        // Extend the player's pickup range down to the ground so low objects
        // like coins can intersect with the box.
        new THREE.Vector3(0.5, 3.2, 0.5)
    );

    const objects = getLoadedObjects();

    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        const rules = obj.userData.rules || {};
        if (rules.pickup) {
            const box = getPickupBox(obj);
            if (!playerBox.intersectsBox(box)) {
                continue;
            }

            const saveKey = getObjectSaveKey(obj);
            const removed = markObjectRemoved(obj);
            if (!removed) {
                continue;
            }

            const type = obj?.userData?.type || 'item';
            if (type === 'coin') {
                const amount = Number.isFinite(obj?.userData?.coinValue)
                    ? obj.userData.coinValue
                    : 1;
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('coinCollected', {
                        detail: { amount }
                    }));
                }
            } else {
                alert(`Picked up: ${type}`);
            }

            if (saveKey && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('gameObjectRemoved', { detail: { saveKey } }));
            }
        }
    }
}

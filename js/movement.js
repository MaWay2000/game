import { getLoadedObjects } from './mapLoader.js';
import { reloadAmmo, setPistolMoving } from './pistol.js';
import { setCrosshairMoving } from './crosshair.js';

export function setupMovement(cameraContainer, camera) {
    const keys = {};
    let enabled = true;
    document.addEventListener('keydown', (e) => {
        keys[e.code] = true;

        if (e.code === 'KeyR') {
            reloadAmmo();
            console.log('?? Reloaded!');
        }
    });

    document.addEventListener('keyup', e => keys[e.code] = false);

    function checkCollision(pos) {
        const playerBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(pos.x, 1.6, pos.z),
            new THREE.Vector3(0.5, 1.6, 0.5)
        );

        const objects = getLoadedObjects();
        for (let obj of objects) {
            const rules = obj.userData.rules || {};
            if (rules.collidable) {
                const box = new THREE.Box3().setFromObject(obj);
                if (playerBox.intersectsBox(box)) return true;
            }
        }
        return false;
    }

    function update() {
        if (!enabled) return;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();

        const speed = 0.03;
        const proposed = cameraContainer.position.clone();

        if (keys['KeyW']) proposed.addScaledVector(dir, speed);
        if (keys['KeyS']) proposed.addScaledVector(dir, -speed);
        if (keys['KeyA']) proposed.addScaledVector(
            new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), speed
        );
        if (keys['KeyD']) proposed.addScaledVector(
            new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), speed
        );

        if (!checkCollision(proposed)) {
            cameraContainer.position.copy(proposed);
        }

        const isMoving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
        const movingBool = !!isMoving;
        setPistolMoving(movingBool);
        setCrosshairMoving(movingBool);
    }

    function setEnabled(val) {
        enabled = val;
        if (!enabled) {
            setCrosshairMoving(false);
        }
    }

    return { update, setEnabled, checkCollision };
}

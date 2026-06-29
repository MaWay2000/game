import { getLoadedObjects } from './mapLoader.js';
import { reloadAmmo, setPistolMoving } from './pistol.js';
import { setCrosshairMoving } from './crosshair.js';

const BASE_SPEED = 0.09;
// Sneaking lowers the player's speed and noise footprint.
const SNEAK_MULTIPLIER = 0.5;
const fallbackCollisionBox = new THREE.Box3();

const runSound = new Audio('sounds/run.mp3');
runSound.loop = true;
runSound.preload = 'auto';
runSound.volume = 0.4;

function ensureRunSoundPlaying() {
    if (!runSound.paused) {
        return;
    }
    const playPromise = runSound.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
            console.warn('Unable to play running sound:', err);
        });
    }
}

function stopRunSound() {
    if (runSound.paused) {
        return;
    }
    runSound.pause();
    runSound.currentTime = 0;
}

function getCollisionBox(obj) {
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

    return fallbackCollisionBox.setFromObject(obj);
}

export function setupMovement(cameraContainer, camera) {
    const keys = {};
    let enabled = true;
    let currentSpeed = BASE_SPEED;
    let sneaking = false;
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
                const box = getCollisionBox(obj);
                if (playerBox.intersectsBox(box)) return true;
            }
        }
        return false;
    }

    function update(delta = 1 / 60) {
        if (!enabled) {
            sneaking = false;
            currentSpeed = BASE_SPEED;
            return;
        }
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();

        let speed = BASE_SPEED;
        const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
        if (shiftHeld) {
            speed *= SNEAK_MULTIPLIER;
            sneaking = true;
        } else {
            sneaking = false;
        }
        currentSpeed = speed;
        const frameSpeed = speed * Math.min(delta, 0.05) * 60;
        const proposed = cameraContainer.position.clone();

        if (keys['KeyW']) proposed.addScaledVector(dir, frameSpeed);
        if (keys['KeyS']) proposed.addScaledVector(dir, -frameSpeed);
        if (keys['KeyA']) proposed.addScaledVector(
            new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), frameSpeed
        );
        if (keys['KeyD']) proposed.addScaledVector(
            new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), frameSpeed
        );

        if (!checkCollision(proposed)) {
            cameraContainer.position.copy(proposed);
        }

        const isMoving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
        const movingBool = !!isMoving;
        setPistolMoving(movingBool);
        setCrosshairMoving(movingBool);

        if (enabled && movingBool && !sneaking) {
            ensureRunSoundPlaying();
        } else {
            stopRunSound();
        }
    }

    function setEnabled(val) {
        enabled = val;
        if (!enabled) {
            setCrosshairMoving(false);
            stopRunSound();
        }
    }

    function getState() {
        return {
            isSneaking: sneaking,
            speed: currentSpeed,
            baseSpeed: BASE_SPEED,
            speedMultiplier: currentSpeed / BASE_SPEED
        };
    }

    return { update, setEnabled, checkCollision, getState };
}

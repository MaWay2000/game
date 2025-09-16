export const TORCH_COLOR = 0xffe5a0;
export const TORCH_INTENSITY = 13.5;
export const TORCH_DISTANCE = 15;
export const TORCH_ANGLE = THREE.MathUtils.degToRad(60);
export const TORCH_PENUMBRA = 0.95;
export const TORCH_DECAY = 1.5;

let torch, torchWorking = true, torchBrokenUntil = 0, nextBreakCheck = 0;
let flickerStart = 0, flickerActive = false, nextFlickerCheck = 0;
let lighterOffSound, lighterOffDamnitSound;
let torchTarget, sceneRef;
let playedOff = false, playedDamnit = false;

export function setupTorch(camera, scene) {
    lighterOffSound = new Audio('sounds/lighteroff.mp3');
    lighterOffDamnitSound = new Audio('sounds/lighteroffdamnit.mp3');
    sceneRef = scene;

    torch = new THREE.SpotLight(
        TORCH_COLOR, TORCH_INTENSITY, TORCH_DISTANCE, TORCH_ANGLE, TORCH_PENUMBRA, TORCH_DECAY
    );
    // Place the light close to the camera and center it on the player's view
    torch.position.set(0, 0, -0.2);
    camera.add(torch);

    torchTarget = new THREE.Object3D();
    scene.add(torchTarget);
    torch.target = torchTarget;

    torchWorking = true;
    torchBrokenUntil = 0;
    nextBreakCheck = performance.now() + Math.random() * 20000 + 5000; // 5–25s window

    return torch;
}

export function updateTorchFlicker(now) {
    if (torchWorking) {
        // Check if torch should break
        if (now > nextBreakCheck) {
            if (Math.random() < 0.21) { // 21% chance every 5–25s
                torchWorking = false;
                const duration = Math.random() * 500 + 3000; // 2–5s
                torchBrokenUntil = now + duration;
                flickerActive = false;
                flickerStart = 0;
                playedOff = false;
                playedDamnit = false;
            }
            nextBreakCheck = now + (Math.random() * 20000 + 5000); // schedule next check in 5–25s
        }
        torch.intensity = TORCH_INTENSITY;
    } else {
        // Flicker: Start 0–2s into break, then for rest of break
        if (!flickerActive && (now > torchBrokenUntil - 2000 || Math.random() < 0.5)) {
            flickerActive = true;
            flickerStart = now;
            nextFlickerCheck = now;
        }

        if (flickerActive) {
            if (now < flickerStart + 500) { // 0.5s burst
                if (now > nextFlickerCheck) {
                    nextFlickerCheck = now + 20; // 50 Hz
                    torch.intensity = (Math.random() > 0.01) ? TORCH_INTENSITY * (0.03 + 0.1 * Math.random()) : 0;
                }
            } else {
                flickerActive = false;
                torch.intensity = 0;
            }
        } else {
            torch.intensity = 0;
        }

        // Sounds
        if (!playedDamnit) {
            lighterOffDamnitSound.play();
            playedDamnit = true;
        }
        if (!playedOff && now > torchBrokenUntil - 400) {
            lighterOffSound.play();
            playedOff = true;
        }

        // Fix torch after break
        if (now > torchBrokenUntil) {
            torchWorking = true;
            torch.intensity = TORCH_INTENSITY;
        }
    }
}

export function updateTorchTarget(camera) {
    const worldPos = new THREE.Vector3();
    camera.getWorldPosition(worldPos);
    const worldDir = new THREE.Vector3();
    camera.getWorldDirection(worldDir);
    torchTarget.position.copy(worldPos.clone().add(worldDir.multiplyScalar(10)));
    if (torchTarget.parent !== sceneRef) sceneRef.add(torchTarget);
}

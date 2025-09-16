import { updateHUD } from './hud.js';
import { getLoadedObjects } from './mapLoader.js';
import { getZombies, damageZombie, registerGunshot } from './zombie.js';
import { notifyCrosshairShot, getCrosshairSpreadRadians } from './crosshair.js';

let pistol;
let clipAmmo = 10;
let maxClip = 10;
let isReloading = false;
let canShoot = true;
let reloadInterval = null;
let reloadTimeout = null;
let pistolMixer;
let reloadFastAction;
let reloadCompleteAction;
let idleAction;
let jogAction;
let currentAction;
let fireAction;
let isMoving = false;
let jumpAction;
let jumpTimeout;
let pistolEnabled = true;

const insertSoundTemplate = new Audio('sounds/pistol-insert.wav');
insertSoundTemplate.volume = 0.5;

const flyingBullets = [];

let bulletTemplate = null;
let bulletLoadPromise = null;

function ensureBulletModel() {
    if (bulletTemplate) {
        return Promise.resolve(bulletTemplate);
    }

    if (!bulletLoadPromise) {
        const loader = new THREE.GLTFLoader();
        bulletLoadPromise = new Promise((resolve, reject) => {
            loader.load(
                'models/bullet.glb',
                gltf => {
                    bulletTemplate = gltf.scene;
                    bulletTemplate.traverse(obj => {
                        if (obj.isMesh) {
                            obj.castShadow = false;
                            obj.receiveShadow = false;
                        }
                        obj.frustumCulled = false;
                    });

                    const boundingBox = new THREE.Box3().setFromObject(bulletTemplate);
                    const size = new THREE.Vector3();
                    boundingBox.getSize(size);
                    const maxDimension = Math.max(size.x, size.y, size.z);
                    const desiredMax = 0.1;
                    if (maxDimension > 0 && maxDimension !== desiredMax) {
                        const scaleFactor = desiredMax / maxDimension;
                        bulletTemplate.scale.multiplyScalar(scaleFactor);
                    }

                    resolve(bulletTemplate);
                },
                undefined,
                err => {
                    console.error('Failed to load bullet model', err);
                    bulletTemplate = null;
                    bulletLoadPromise = null;
                    reject(err);
                }
            );
        });
    }

    return bulletLoadPromise;
}

function scheduleRandomJump() {
    if (!jumpAction) return;
    clearTimeout(jumpTimeout);
    const delay = Math.random() * 7000 + 3000;
    jumpTimeout = setTimeout(() => {
        if (!isMoving && !isReloading && currentAction === idleAction) {
            currentAction.fadeOut(0.2);
            jumpAction.reset().fadeIn(0.2).play();
            currentAction = jumpAction;
            const duration = jumpAction.getClip().duration * 1000;
            setTimeout(() => {
                if (!isMoving && !isReloading) {
                    jumpAction.fadeOut(0.2);
                    idleAction.reset().fadeIn(0.2).play();
                    currentAction = idleAction;
                    scheduleRandomJump();
                }
            }, duration);
        } else {
            scheduleRandomJump();
        }
    }, delay);
}

export function addPistolToCamera(camera) {
    ensureBulletModel().catch(() => {});

    const loader = new THREE.GLTFLoader();
    loader.load(
        'models/pistol.glb',
        gltf => {
            pistol = gltf.scene;

            // Log available animation clips for future reference
            if (gltf.animations && gltf.animations.length) {
                console.log('Pistol actions:', gltf.animations.map(clip => clip.name));
                pistolMixer = new THREE.AnimationMixer(pistol);

                const reloadFastClip = THREE.AnimationClip.findByName(gltf.animations, 'Reload_Fast');
                if (reloadFastClip) {
                    reloadFastAction = pistolMixer.clipAction(reloadFastClip);
                    reloadFastAction.setLoop(THREE.LoopOnce, 1);
                    reloadFastAction.clampWhenFinished = true;
                }

                const reloadCompleteClip = THREE.AnimationClip.findByName(gltf.animations, 'Reload_Complete');
                if (reloadCompleteClip) {
                    reloadCompleteAction = pistolMixer.clipAction(reloadCompleteClip);
                    reloadCompleteAction.setLoop(THREE.LoopOnce, 1);
                    reloadCompleteAction.clampWhenFinished = true;
                }

                const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
                if (idleClip) {
                    idleAction = pistolMixer.clipAction(idleClip);
                    idleAction.play();
                    currentAction = idleAction;
                }

                const jumpClip = THREE.AnimationClip.findByName(gltf.animations, 'Jump');
                if (jumpClip) {
                    jumpAction = pistolMixer.clipAction(jumpClip);
                    jumpAction.setLoop(THREE.LoopOnce, 1);
                    jumpAction.clampWhenFinished = true;
                }

                const jogClip = THREE.AnimationClip.findByName(gltf.animations, 'Jog');
                if (jogClip) {
                    jogAction = pistolMixer.clipAction(jogClip);
                }

                const fireClip = THREE.AnimationClip.findByName(gltf.animations, 'Fire');
                if (fireClip) {
                    fireAction = pistolMixer.clipAction(fireClip);
                    fireAction.setLoop(THREE.LoopOnce, 1);
                    fireAction.clampWhenFinished = true;
                }

                if (idleAction && jumpAction) {
                    scheduleRandomJump();
                }
            } else {
                console.log('Pistol has no animations');
            }

            // Attach the pistol to the camera and ensure it's always rendered
            pistol.traverse(obj => {
                obj.frustumCulled = false;
                obj.layers.set(1);

                // Hide loose bullet/shell meshes that appear in first person view
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                if (mats.some(m => m && m.name && /bullet|shell/i.test(m.name))) {
                    obj.visible = false;
                }
            });
            pistol.position.set(0.4, -0.3, -0.7);
            pistol.rotation.y = Math.PI; // Ensure pistol faces the camera
            camera.add(pistol);
        },
        undefined,
        err => {
            console.error('Failed to load pistol model', err);
        }
    );

    updateHUD(clipAmmo);
}

export async function shootPistol(scene, camera) {
    if (!pistolEnabled) {
        return;
    }

    if (!pistol) {
        console.warn('Pistol not ready.');
        return;
    }

    if (isReloading) {
        if (clipAmmo === 0) {
            console.log("? Reloading...");
            return;
        }
        console.log(clipAmmo > 0 ? "? Reload canceled + firing..." : "? Reload canceled.");
        isReloading = false;
        if (reloadInterval) {
            clearInterval(reloadInterval);
            reloadInterval = null;
        }
        if (reloadTimeout) {
            clearTimeout(reloadTimeout);
            reloadTimeout = null;
        }
        reloadFastAction?.stop();
        reloadCompleteAction?.stop();
        canShoot = true;
        setPistolMoving(isMoving);

        if (clipAmmo > 0) {
            setTimeout(() => shootPistol(scene, camera), 0);
        }
        return;
    }

    if (!canShoot) {
        console.log("? Wait...");
        return;
    }

    if (clipAmmo <= 0) {
        console.log("?? Out of ammo. Auto-reloading...");
        if (!isReloading) {
            reloadAmmo(() => {
                canShoot = true;
            });
        }
        return;
    }

    canShoot = false;

    try {
        await ensureBulletModel();
    } catch (err) {
        console.warn('Unable to fire pistol because the bullet model failed to load.');
        canShoot = true;
        return;
    }

    if (!bulletTemplate) {
        console.warn('Bullet model not available.');
        canShoot = true;
        return;
    }

    clipAmmo--;
    notifyCrosshairShot();
    fireAction?.reset().play();

    const bullet = bulletTemplate.clone(true);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.normalize();

    const spreadRadians = getCrosshairSpreadRadians();
    if (spreadRadians > 0) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

        const horizontalAngle = (Math.random() * 2 - 1) * spreadRadians;
        const verticalAngle = (Math.random() * 2 - 1) * spreadRadians;

        direction
            .add(right.multiplyScalar(Math.tan(horizontalAngle)))
            .add(up.multiplyScalar(Math.tan(verticalAngle)))
            .normalize();
    }

    const worldPosition = camera.getWorldPosition(new THREE.Vector3());
    bullet.position.copy(worldPosition);

    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    bullet.quaternion.copy(orientation);

    bullet.userData = {
        velocity: direction.clone().multiplyScalar(0.5),
        life: 0
    };

    // Notify zombies about the gunshot so they can investigate
    registerGunshot(bullet.position);

    scene.add(bullet);
    flyingBullets.push(bullet);

    // Flash
    const flash = new THREE.PointLight(0xffaa33, 2, 5);
    flash.position.copy(camera.getWorldPosition(new THREE.Vector3()));
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 100);

    // Sound
    const fireSound = new Audio('sounds/pistol-fire.wav');
    fireSound.volume = 0.4;
    fireSound.play();

    console.log(`Bang! Ammo: ${clipAmmo}`);
    updateHUD(clipAmmo);

    // Allow shooting again after short delay or trigger reload when empty
    setTimeout(() => {
        if (clipAmmo === 0) {
            console.log("?? Empty clip. Auto-reloading...");
            reloadAmmo(() => {
                canShoot = true;
            });
        } else {
            canShoot = true;
        }
    }, 170);
}

export function reloadAmmo(onReloaded) {
    if (!pistolEnabled) {
        onReloaded?.();
        return;
    }

    if (!pistol) {
        console.warn('Pistol not ready.');
        onReloaded?.();
        return;
    }

    if (isReloading || clipAmmo === maxClip) {
        console.log("? Already full or reloading.");
        onReloaded?.();
        return;
    }

    isReloading = true;
    clearTimeout(jumpTimeout);

    const reloadStart = new Audio('sounds/pistol-reload.wav');
    reloadStart.volume = 0.6;
    reloadStart.play();

    currentAction?.stop();
    currentAction = null;

    if (reloadInterval) {
        clearInterval(reloadInterval);
        reloadInterval = null;
    }
    if (reloadTimeout) {
        clearTimeout(reloadTimeout);
        reloadTimeout = null;
    }

    if (clipAmmo === 0 && reloadCompleteAction) {
        console.log("? Reloading from empty...");
        reloadCompleteAction.timeScale = 1;
        reloadCompleteAction.reset().play();
        const duration = (reloadCompleteAction.getClip().duration / reloadCompleteAction.timeScale) * 1000;
        reloadTimeout = setTimeout(() => {
            clipAmmo = maxClip;
            updateHUD(clipAmmo);
            isReloading = false;
            console.log("? Reload complete.");
            onReloaded?.();
            reloadCompleteAction.stop();
            setPistolMoving(isMoving);
            reloadTimeout = null;
        }, duration);
        return;
    }

    console.log("? Reloading one by one...");

    const intervalDuration = 400;
    if (reloadFastAction) {
        reloadFastAction.timeScale = 1;
        reloadFastAction.reset().play();
    }

    reloadInterval = setInterval(() => {
        if (!isReloading) {
            clearInterval(reloadInterval);
            reloadInterval = null;
            reloadFastAction?.stop();
            setPistolMoving(isMoving);
            return;
        }

        if (clipAmmo < maxClip) {
            clipAmmo++;
            updateHUD(clipAmmo);
            console.log(`?? +1 Bullet... Ammo: ${clipAmmo}`);

            const insertSound = insertSoundTemplate.cloneNode();
            insertSound.play();
            if (reloadFastAction) {
                reloadFastAction.reset().play();
            }
        } else {
            clearInterval(reloadInterval);
            reloadInterval = null;
            isReloading = false;
            console.log("? Reload complete.");
            onReloaded?.();
            reloadFastAction?.stop();
            setPistolMoving(isMoving);
        }
    }, intervalDuration);
}

export function setPistolMoving(moving) {
    isMoving = moving;
    if (!pistolEnabled) return;
    if (!pistolMixer || !idleAction || !jogAction || isReloading) return;

    const target = moving ? jogAction : idleAction;

    // Allow the jump animation to finish when the player is idle.
    // Movement.js calls this function every frame, which previously
    // caused the idle jump clip to be interrupted and skipped after
    // only a few frames.  If we're not moving and the jump animation
    // is currently playing, leave it alone so it can play its full
    // duration.
    if (!moving && currentAction === jumpAction) {
        return;
    }

    if (currentAction === target) return;

    currentAction?.fadeOut(0.2);
    target.reset().fadeIn(0.2).play();
    currentAction = target;

    if (moving) {
        clearTimeout(jumpTimeout);
    } else if (currentAction !== jumpAction) {
        scheduleRandomJump();
    }
}

export function setPistolEnabled(enabled) {
    const wasEnabled = pistolEnabled;

    if (!enabled && wasEnabled) {
        setPistolMoving(false);
    }

    pistolEnabled = enabled;

    if (!enabled) {
        canShoot = false;
        if (reloadInterval) {
            clearInterval(reloadInterval);
            reloadInterval = null;
        }
        if (reloadTimeout) {
            clearTimeout(reloadTimeout);
            reloadTimeout = null;
        }
        isReloading = false;
        reloadFastAction?.stop();
        reloadCompleteAction?.stop();
        if (jumpTimeout) {
            clearTimeout(jumpTimeout);
            jumpTimeout = null;
        }
        jumpAction?.stop();
    } else {
        canShoot = true;
    }

    if (pistol) {
        pistol.visible = enabled;
    }
}

export function updateBullets(deltaTime) {
    if (pistolMixer) {
        pistolMixer.update(deltaTime);
    }
    for (let i = flyingBullets.length - 1; i >= 0; i--) {
        const bullet = flyingBullets[i];
        bullet.position.addScaledVector(bullet.userData.velocity, deltaTime * 60);
        bullet.userData.life += deltaTime;

        const bulletBox = new THREE.Box3().setFromObject(bullet);
        const objects = getLoadedObjects();
        let hit = false;

        for (const obj of objects) {
            const rules = obj.userData.rules || {};
            if (obj.userData.ai) continue;
            if (rules.collidable) {
                const objBox = new THREE.Box3().setFromObject(obj);
                if (bulletBox.intersectsBox(objBox)) {
                    hit = true;
                    break;
                }
            }
        }

        if (!hit) {
            const zombies = getZombies();
            for (const zombie of zombies) {
                if (zombie.userData.hp <= 0) continue;
                const zombieBox = new THREE.Box3().setFromObject(zombie);
                if (bulletBox.intersectsBox(zombieBox)) {
                    hit = true;
                    damageZombie(zombie, 1, bullet.userData.velocity, bullet.position.clone());
                    break;
                }
            }
        }

        if (hit || bullet.userData.life > 2) {
            bullet.parent?.remove(bullet);
            flyingBullets.splice(i, 1);
        }
    }
}

import { updateHUD } from './hud.js';
import { getLoadedObjects } from './mapLoader.js';
import { getZombies, damageZombie } from './zombie.js';

let pistol;
let clipAmmo = 10;
let maxClip = 10;
let isReloading = false;
let canShoot = true;
let reloadInterval = null;

const insertSoundTemplate = new Audio('sounds/pistol-insert.wav');
insertSoundTemplate.volume = 0.5;

const flyingBullets = [];

export function addPistolToCamera(camera) {
    const geometry = new THREE.BoxGeometry(0.3, 0.2, 0.6);
    const material = new THREE.MeshLambertMaterial({ color: 0x222222 });
    pistol = new THREE.Mesh(geometry, material);
    pistol.position.set(0.4, -0.3, -0.7);
    camera.add(pistol);

    updateHUD(clipAmmo, 100);
}

export function shootPistol(scene, camera) {
    if (!pistol) {
        console.warn('Pistol not ready.');
        return;
    }

    if (isReloading) {
        console.log("? Reload canceled + firing...");
        isReloading = false;
        if (reloadInterval) clearInterval(reloadInterval);
        pistol.position.y += 0.2;
        canShoot = true;

        setTimeout(() => shootPistol(scene, camera), 0);
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

    clipAmmo--;
    canShoot = false;

    // Create bullet
    const bulletGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    bullet.position.copy(camera.getWorldPosition(new THREE.Vector3()));

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.normalize();

    bullet.userData = {
        velocity: direction.clone().multiplyScalar(0.5),
        life: 0
    };

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
    updateHUD(clipAmmo, 100);

    // ?? Auto-reload if not full
    setTimeout(() => {
        if (clipAmmo < maxClip && !isReloading) {
            console.log("?? Auto-reloading: clip not full.");
            reloadAmmo(() => {
                canShoot = true;
            });
        } else {
            canShoot = true;
        }
    }, 170);
}

export function reloadAmmo(onReloaded) {
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
    console.log("? Reloading one by one...");

    const reloadStart = new Audio('sounds/pistol-reload.wav');
    reloadStart.volume = 0.6;
    reloadStart.play();

    const originalY = pistol.position.y;
    pistol.position.y -= 0.2;

    reloadInterval = setInterval(() => {
        if (!isReloading) {
            clearInterval(reloadInterval);
            return;
        }

        if (clipAmmo < maxClip) {
            clipAmmo++;
            updateHUD(clipAmmo, 100);
            console.log(`?? +1 Bullet... Ammo: ${clipAmmo}`);

            const insertSound = insertSoundTemplate.cloneNode();
            insertSound.play();
        } else {
            clearInterval(reloadInterval);
            pistol.position.y = originalY;
            isReloading = false;
            console.log("? Reload complete.");
            onReloaded?.();
        }
    }, 400);
}

export function updateBullets(deltaTime) {
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
                    damageZombie(zombie, 1, bullet.userData.velocity);
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

// zombie.js

let zombies = [];
let zombieTypeIds = null;

// Helper for 3D distance
function distance3D(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Loads zombie type ids from zombies.json (async, cached)
async function getZombieTypeIds() {
    if (zombieTypeIds) return zombieTypeIds;
    try {
        const res = await fetch('zombies.json');
        const defs = await res.json();
        zombieTypeIds = defs.map(z => z.id);
        return zombieTypeIds;
    } catch (e) {
        return [];
    }
}

// Loads zombies from map objects (Mesh-based!)
export async function spawnZombiesFromMap(scene, mapObjects, models, materials) {
    zombies = [];
    const zombieIds = await getZombieTypeIds();

    mapObjects.forEach(obj => {
        const objType = obj.userData ? obj.userData.type : undefined;
        if (zombieIds.includes(objType)) {
            // Use the map Mesh as zombie (don't create duplicate)
            obj.userData.hp = obj.userData.hp ?? 10;
            obj.userData.spotDistance = obj.userData.spotDistance ?? obj.userData.aggro_range ?? 8;
            obj.userData.speed = obj.userData.speed ?? 0.01;
            obj.userData.ai = true;
            zombies.push(obj);
        }
    });
}

// Returns all zombie meshes
export function getZombies() {
    return zombies;
}

// Basic AI: Only "active" if within spotDistance of player!
// Make sure to pass [...getLoadedObjects(), ...getZombies()] as collidableObjects!
export function updateZombies(playerPosition, delta, collidableObjects = [], onPlayerCollide = () => {}) {
    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0) return; // dead

        const spotDistance = zombie.userData.spotDistance || 8;
        const dist = distance3D(zombie.position, playerPosition);

        // --- Wander when player is far away ---
        if (dist > spotDistance) {
            if (!zombie.userData.wanderDir || zombie.userData.wanderTimeout < performance.now()) {
                const angle = Math.random() * Math.PI * 2;
                zombie.userData.wanderDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
                zombie.userData.wanderTimeout = performance.now() + 2000 + Math.random() * 3000;
            }

            const step = zombie.userData.speed * delta * 60 * 0.5;
            const move = zombie.userData.wanderDir.clone().setLength(step);
            const nextPos = zombie.position.clone().add(move);
            const zombieBox = new THREE.Box3().setFromObject(zombie);
            zombieBox.translate(move);
            let collision = false;
            for (const obj of collidableObjects) {
                if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                if (obj === zombie) continue;
                const objBox = new THREE.Box3().setFromObject(obj);
                if (zombieBox.intersectsBox(objBox)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                zombie.position.copy(nextPos);
            } else {
                zombie.userData.wanderTimeout = 0; // pick new dir next frame
            }
            zombie.lookAt(zombie.position.x + zombie.userData.wanderDir.x, zombie.position.y, zombie.position.z + zombie.userData.wanderDir.z);
            return; // done with idle behaviour
        }

        if (dist < 0.5) {
            const pushDir = new THREE.Vector3().copy(playerPosition).sub(zombie.position);
            pushDir.y = 0;
            if (pushDir.lengthSq() > 0) {
                pushDir.normalize();
                const pushDistance = 1;
                const pushAttempts = [
                    pushDir.clone().multiplyScalar(pushDistance),
                    new THREE.Vector3(-pushDir.z, 0, pushDir.x).multiplyScalar(pushDistance),
                    new THREE.Vector3(pushDir.z, 0, -pushDir.x).multiplyScalar(pushDistance)
                ];

                for (const attempt of pushAttempts) {
                    const nextPlayerPos = playerPosition.clone().add(attempt);
                    // Use bounding boxes to check for collisions like the player movement code
                    const playerBox = new THREE.Box3().setFromCenterAndSize(
                        new THREE.Vector3(nextPlayerPos.x, 1.6, nextPlayerPos.z),
                        new THREE.Vector3(0.5, 1.6, 0.5)
                    );
                    let collision = false;
                    for (const obj of collidableObjects) {
                        if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                        if (obj === zombie) continue;
                        const objBox = new THREE.Box3().setFromObject(obj);
                        if (playerBox.intersectsBox(objBox)) {
                            collision = true;
                            break;
                        }
                    }
                    if (!collision) {
                        playerPosition.copy(nextPlayerPos);
                        break;
                    }
                }
            }
            onPlayerCollide();
        }

        // --- Simple AI: move toward player with simple avoidance ---
        const toPlayer = new THREE.Vector3().copy(playerPosition).sub(zombie.position);
        if (toPlayer.length() > 0.1) {
            const step = zombie.userData.speed * delta * 60;
            toPlayer.setLength(step);

            const attemptMove = move => {
                const nextPos = zombie.position.clone().add(move);
                const zombieBox = new THREE.Box3().setFromObject(zombie);
                zombieBox.translate(move);
                for (const obj of collidableObjects) {
                    if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                    if (obj === zombie) continue; // Don't collide with self
                    const objBox = new THREE.Box3().setFromObject(obj);
                    if (zombieBox.intersectsBox(objBox)) {
                        return false;
                    }
                }
                zombie.position.copy(nextPos);
                return true;
            };

            if (!attemptMove(toPlayer)) {
                const left = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).setLength(step);
                if (!attemptMove(left)) {
                    const right = left.clone().negate();
                    attemptMove(right);
                }
            }

            zombie.lookAt(playerPosition.x, zombie.position.y, playerPosition.z);
        }
    });
}

// Damage zombie
export function damageZombie(zombie, dmg) {
    zombie.userData.hp -= dmg;
    if (zombie.userData.hp <= 0) {
        zombie.visible = false; // or play anim/remove
    }
}

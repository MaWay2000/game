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

        if (dist > spotDistance) return; // out of aggro range

        if (dist < 0.5) {
            onPlayerCollide();
        }

        // --- Simple AI: move toward player with collision ---
        const toPlayer = new THREE.Vector3().copy(playerPosition).sub(zombie.position);
        if (toPlayer.length() > 0.1) {
            toPlayer.setLength(zombie.userData.speed * delta * 60);

            // Try to move and avoid walls and other zombies!
            const nextPos = zombie.position.clone().add(toPlayer);
            let collision = false;
            for (const obj of collidableObjects) {
                if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                if (obj === zombie) continue; // Don't collide with self
                // You may want to use a larger threshold for big zombies/objects
                if (nextPos.distanceTo(obj.position) < 0.5) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                zombie.position.copy(nextPos);
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

// zombie.js

let zombies = [];
let zombieTypeIds = null;

// Helper for 3D distance
function distance3D(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Build a simple grid of blocked cells from collidable objects
function buildObstacleMap(objects) {
    const map = new Set();
    for (const obj of objects) {
        const rules = obj.userData && obj.userData.rules;
        if (!rules || !rules.collidable) continue;
        const box = new THREE.Box3().setFromObject(obj);
        const minX = Math.floor(box.min.x);
        const maxX = Math.floor(box.max.x);
        const minZ = Math.floor(box.min.z);
        const maxZ = Math.floor(box.max.z);
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                map.add(`${x},${z}`);
            }
        }
    }
    return map;
}

// Breadth-first search on grid to reach goal
function findPath(start, goal, obstacles, maxNodes = 4000) {
    const startKey = `${start.x},${start.z}`;
    const queue = [start];
    const cameFrom = { [startKey]: null };
    const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1]
    ];
    while (queue.length && Object.keys(cameFrom).length < maxNodes) {
        const current = queue.shift();
        const curKey = `${current.x},${current.z}`;
        if (current.x === goal.x && current.z === goal.z) {
            const path = [];
            let k = curKey;
            while (k) {
                const [cx, cz] = k.split(',').map(Number);
                path.push({ x: cx + 0.5, z: cz + 0.5 });
                k = cameFrom[k];
            }
            path.reverse();
            path.shift(); // remove start
            return path;
        }
        for (const [dx, dz] of dirs) {
            const nx = current.x + dx, nz = current.z + dz;
            const nk = `${nx},${nz}`;
            if (cameFrom[nk] !== undefined) continue;
            if (obstacles.has(nk) && nk !== startKey) continue;
            cameFrom[nk] = curKey;
            queue.push({ x: nx, z: nz });
        }
    }
    return [];
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
    const obstacleMap = buildObstacleMap(collidableObjects);
    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0) return; // dead

        const stepBase = zombie.userData.speed * delta * 60;
        const attemptMove = move => {
            const nextPos = zombie.position.clone().add(move);
            const zombieBox = new THREE.Box3().setFromObject(zombie);
            zombieBox.translate(move);
            let collision = false;
            for (const obj of collidableObjects) {
                if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                if (obj === zombie) continue; // Don't collide with self
                const objBox = new THREE.Box3().setFromObject(obj);
                if (zombieBox.intersectsBox(objBox)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                zombie.position.copy(nextPos);
                return true;
            }

            const axisMoves = [
                new THREE.Vector3(move.x, 0, 0),
                new THREE.Vector3(0, 0, move.z)
            ];
            for (const axisMove of axisMoves) {
                if (axisMove.lengthSq() === 0) continue;
                const axisBox = new THREE.Box3().setFromObject(zombie);
                axisBox.translate(axisMove);
                let axisCollision = false;
                for (const obj of collidableObjects) {
                    if (!obj.userData || !obj.userData.rules || !obj.userData.rules.collidable) continue;
                    if (obj === zombie) continue;
                    const objBox = new THREE.Box3().setFromObject(obj);
                    if (axisBox.intersectsBox(objBox)) {
                        axisCollision = true;
                        break;
                    }
                }
                if (!axisCollision) {
                    zombie.position.add(axisMove);
                    return true;
                }
            }

            zombie.position.add(move.clone().multiplyScalar(-0.5));
            return false;
        };

        const spotDistance = zombie.userData.spotDistance || 8;
        const dist = distance3D(zombie.position, playerPosition);

        // --- Wander when player is far away ---
        if (dist > spotDistance) {
            zombie.userData.path = [];
            if (!zombie.userData.wanderDir || zombie.userData.wanderTimeout < performance.now()) {
                const angle = Math.random() * Math.PI * 2;
                zombie.userData.wanderDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
                zombie.userData.wanderTimeout = performance.now() + 2000 + Math.random() * 3000;
            }

            const step = stepBase * 0.5;
            const move = zombie.userData.wanderDir.clone().setLength(step);
            if (!attemptMove(move)) {
                zombie.userData.wanderTimeout = 0; // pick new dir next frame
            }
            zombie.lookAt(zombie.position.x + zombie.userData.wanderDir.x, zombie.position.y, zombie.position.z + zombie.userData.wanderDir.z);
            return; // done with idle behaviour
        }

        // --- Follow path if one exists ---
        if (zombie.userData.path && zombie.userData.path.length > 0) {
            const target = zombie.userData.path[0];
            const dir = new THREE.Vector3(target.x - zombie.position.x, 0, target.z - zombie.position.z);
            if (dir.length() < 0.2) {
                zombie.userData.path.shift();
            } else {
                dir.setLength(stepBase);
                if (attemptMove(dir)) {
                    zombie.lookAt(zombie.position.x + dir.x, zombie.position.y, zombie.position.z + dir.z);
                    return;
                } else {
                    zombie.userData.path = [];
                }
            }
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

        // --- Move toward player using simple pathfinding ---
        const toPlayer = new THREE.Vector3().copy(playerPosition).sub(zombie.position);
        if (toPlayer.length() > 0.1) {
            const moveDir = toPlayer.clone().setLength(stepBase);
            if (!attemptMove(moveDir)) {
                const start = { x: Math.floor(zombie.position.x), z: Math.floor(zombie.position.z) };
                const goal = { x: Math.floor(playerPosition.x), z: Math.floor(playerPosition.z) };
                const path = findPath(start, goal, obstacleMap);
                if (path.length > 0) {
                    zombie.userData.path = path;
                } else {
                    const left = new THREE.Vector3(-moveDir.z, 0, moveDir.x).setLength(stepBase);
                    if (!attemptMove(left)) {
                        const right = left.clone().negate();
                        attemptMove(right);
                    }
                }
            } else {
                zombie.lookAt(playerPosition.x, zombie.position.y, playerPosition.z);
            }
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

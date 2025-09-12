// zombie.js

let zombies = [];
let zombieTypeIds = null;
const DEFAULT_ZOMBIE_SIZE = [0.7, 1.8, 0.7];

// Helper for horizontal distance (ignore Y axis)
function distanceXZ(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
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

// Clone a GLTF scene including skinned mesh skeletons so that
// animations work on independent instances. Based on THREE's
// SkeletonUtils.clone helper.
function cloneSkinned(source) {
    const sourceLookup = new Map();
    const cloneLookup = new Map();

    const clone = source.clone(true);

    parallelTraverse(source, clone, (srcNode, clonedNode) => {
        sourceLookup.set(clonedNode, srcNode);
        cloneLookup.set(srcNode, clonedNode);
    });

    clone.traverse(node => {
        if (!node.isSkinnedMesh) return;

        const srcMesh = sourceLookup.get(node);
        const srcBones = srcMesh.skeleton.bones;

        node.skeleton = srcMesh.skeleton.clone();
        node.bindMatrix.copy(srcMesh.bindMatrix);

        node.skeleton.bones = srcBones.map(bone => cloneLookup.get(bone));
        node.bind(node.skeleton, node.bindMatrix);
    });

    return clone;
}

function parallelTraverse(a, b, callback) {
    callback(a, b);
    for (let i = 0; i < a.children.length; i++) {
        parallelTraverse(a.children[i], b.children[i], callback);
    }
}

// Loads zombies from map objects (Mesh-based!)
export async function spawnZombiesFromMap(scene, mapObjects, models, materials) {
    zombies = [];

    // Try to load zombie type IDs, but don't rely solely on them. If the
    // fetch fails (e.g. offline or missing file) fall back to objects that
    // already have the `ai` flag set in their userData.
    let zombieIds = [];
    try {
        zombieIds = await getZombieTypeIds();
    } catch (e) {
        zombieIds = [];
    }

    for (let i = 0; i < mapObjects.length; i++) {
        const obj = mapObjects[i];
        const objType = obj.userData ? obj.userData.type : undefined;
        const isZombie = (obj.userData && obj.userData.ai) ||
            (objType && zombieIds.includes(objType));
        if (!isZombie) continue;

        let zombieMesh = obj;
        const modelPath = obj.userData && obj.userData.rules ? obj.userData.rules.model : undefined;

        // If a GLTF model with animations is available, clone it so that the
        // skeleton/bones can animate independently.
        if (models && objType && models[objType] && models[objType].scene) {
            console.log(`Spawning zombie ${objType} using model ${modelPath || 'unknown'}`);
            zombieMesh = cloneSkinned(models[objType].scene);
            zombieMesh.position.copy(obj.position);
            zombieMesh.rotation.copy(obj.rotation);
            zombieMesh.userData = { ...obj.userData };

            // Scale model to match defined geometry size (so zombies aren't gigantic)
            const rule = zombieMesh.userData && zombieMesh.userData.rules;
            const targetSize = (rule && rule.geometry) ? rule.geometry : DEFAULT_ZOMBIE_SIZE;

            // Initial bounding box
            zombieMesh.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(zombieMesh);
            const size = new THREE.Vector3();
            box.getSize(size);

            // If any dimension is zero, recompute using mesh geometries to avoid
            // oversized models when bounding boxes are missing (e.g. skinned meshes)
            if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
                box.makeEmpty();
                zombieMesh.traverse(node => {
                    if (node.isMesh && node.geometry) {
                        node.geometry.computeBoundingBox();
                        const nodeBox = node.geometry.boundingBox.clone();
                        nodeBox.applyMatrix4(node.matrixWorld);
                        box.union(nodeBox);
                    }
                });
                box.getSize(size);
            }

            if (size.x > 0 && size.y > 0 && size.z > 0) {
                zombieMesh.scale.set(
                    targetSize[0] / size.x,
                    targetSize[1] / size.y,
                    targetSize[2] / size.z
                );
            }

            if (models[objType].animations && models[objType].animations.length > 0) {
                const mixer = new THREE.AnimationMixer(zombieMesh);
                const actions = {};
                models[objType].animations.forEach(clip => {
                    actions[clip.name] = mixer.clipAction(clip);
                });

                // Log available animation clip names for debugging
                const actionNames = Object.keys(actions);
                if (actionNames.length > 0) {
                    console.log(`Zombie ${objType} animation clips:`, actionNames);
                }

                zombieMesh.userData.mixer = mixer;
                zombieMesh.userData.actions = actions;
                zombieMesh.userData._actionPlaying = false;
            } else {
                console.log(`Zombie ${objType} model has no animations; static model will not output animation logs.`);
            }

            scene.add(zombieMesh);
            if (obj.parent) obj.parent.remove(obj);
            mapObjects[i] = zombieMesh;
        } else {
            console.log(`Spawning zombie ${objType || 'unknown'} without external model`);
        }

        zombieMesh.userData.hp = zombieMesh.userData.hp ?? 10;
        zombieMesh.userData.spotDistance = zombieMesh.userData.spotDistance ?? zombieMesh.userData.aggro_range ?? 8;
        zombieMesh.userData.speed = zombieMesh.userData.speed ?? 0.01;
        zombieMesh.userData.ai = true;
        zombies.push(zombieMesh);
    }
}

// Returns all zombie meshes
export function getZombies() {
    return zombies;
}

function setZombieAnimation(zombie, moving) {
    if (!zombie.userData || !zombie.userData.actions) return;

    // Determine and cache a suitable "moving" action if not already set.
    if (!zombie.userData._movingAction) {
        const names = Object.keys(zombie.userData.actions);
        if (names.length === 0) return;
        const clipName = names[0];
        zombie.userData._movingAction = zombie.userData.actions[clipName];

        const zombieName = zombie.name || zombie.userData.type || zombie.uuid;
        console.log(`Zombie ${zombieName} loaded clip ${clipName}`);
    }

    const action = zombie.userData._movingAction;
    if (!action) return;

    if (moving) {
        if (!zombie.userData._actionPlaying) {
            action.reset().play();
            zombie.userData._actionPlaying = true;
        }
    } else if (zombie.userData._actionPlaying) {
        action.stop();
        zombie.userData._actionPlaying = false;
    }
}

// Update zombies: keep them stationary but let their animations run
// Parameters are retained for API compatibility but are unused.
export function updateZombies(playerPosition, delta, collidableObjects = [], onPlayerCollide = () => {}) {
    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0) return; // dead

        if (zombie.userData.mixer) {
            zombie.userData.mixer.update(delta);
        }

        // Always treat zombies as "moving" so their walk animation plays
        setZombieAnimation(zombie, true);
    });
}

// Damage zombie
export function damageZombie(zombie, dmg) {
    zombie.userData.hp -= dmg;
    if (zombie.userData.hp > 0 && zombie.userData._movingAction) {
        zombie.userData._movingAction.reset().play();
    }
    if (zombie.userData.hp <= 0) {
        zombie.visible = false; // or play anim/remove
    }
}

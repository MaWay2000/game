// zombie.js

import { getLoadedObjects } from './mapLoader.js';

let zombies = [];
let zombieTypeIds = null;
const DEFAULT_ZOMBIE_SIZE = [0.7, 1.8, 0.7];

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

            // Compute and cache original model bounding box once per zombie type
            if (!models[objType]._size) {
                const src = models[objType].scene;
                src.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(src);
                const size = new THREE.Vector3();
                box.getSize(size);

                // If any dimension is zero, recompute using mesh geometries to avoid
                // oversized models when bounding boxes are missing (e.g. skinned meshes)
                if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
                    box.makeEmpty();
                    src.traverse(node => {
                        if (node.isMesh && node.geometry) {
                            node.geometry.computeBoundingBox();
                            const nodeBox = node.geometry.boundingBox.clone();
                            nodeBox.applyMatrix4(node.matrixWorld);
                            box.union(nodeBox);
                        }
                    });
                    box.getSize(size);
                }

                models[objType]._size = size;
            }

            const size = models[objType]._size;
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
        zombieMesh.userData.attackCooldown = zombieMesh.userData.attackCooldown ?? 1;
        // AI disabled: mark zombie as non-AI
        zombieMesh.userData.ai = false;
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

// Simple collision check for zombies using loaded map objects
function checkZombieCollision(zombie, proposed, collidables) {
    const size = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
        ? zombie.userData.rules.geometry
        : DEFAULT_ZOMBIE_SIZE;
    const center = new THREE.Vector3(proposed.x, proposed.y + size[1] / 2, proposed.z);
    const box = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(...size));
    for (const obj of collidables) {
        if (obj === zombie) continue;
        const objBox = new THREE.Box3().setFromObject(obj);
        if (box.intersectsBox(objBox)) return true;
    }
    return false;
}

// Update zombies: handle animation and simple wandering movement
export function updateZombies(delta, playerObj, onPlayerHit) {
    const allObjects = getLoadedObjects();
    const collidableObjects = allObjects.filter(o => {
        const rules = (o.userData && o.userData.rules) ? o.userData.rules : {};
        return rules.collidable;
    });

    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0) return;
        if (zombie.userData.mixer) {
            zombie.userData.mixer.update(delta);
        }

        let moving = false;
        // Wander randomly
        zombie.userData._wanderTime = zombie.userData._wanderTime ?? 0;
        zombie.userData._wanderDir = zombie.userData._wanderDir || new THREE.Vector3();
        if (zombie.userData._wanderTime <= 0) {
            const angle = Math.random() * Math.PI * 2;
            zombie.userData._wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
            zombie.userData._wanderTime = 2 + Math.random() * 3;
        }
        const proposed = zombie.position.clone().addScaledVector(zombie.userData._wanderDir, zombie.userData.speed * 0.5);
        if (!checkZombieCollision(zombie, proposed, collidableObjects)) {
            zombie.position.copy(proposed);
            // Rotate to face the direction of movement
            zombie.rotation.y = Math.atan2(
                zombie.userData._wanderDir.x,
                zombie.userData._wanderDir.z
            );
            moving = true;
        } else {
            zombie.userData._wanderTime = 0; // pick new direction next frame
        }
        zombie.userData._wanderTime -= delta;

        setZombieAnimation(zombie, moving);
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

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
        zombieMesh.userData.turnSpeed = zombieMesh.userData.turnSpeed ?? 5;
        // Mark zombie objects for AI interactions (e.g., bullet hit tests)
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

// Simple collision check for player using loaded map objects
function checkPlayerCollision(pos, collidables) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(pos.x, 1.6, pos.z),
        new THREE.Vector3(0.5, 1.6, 0.5)
    );
    for (const obj of collidables) {
        const box = new THREE.Box3().setFromObject(obj);
        if (playerBox.intersectsBox(box)) return true;
    }
    return false;
}

// Update zombies: handle animation and simple wandering movement
export function updateZombies(delta, playerObj, onPlayerHit) {
    const allObjects = getLoadedObjects();
    const collidableObjects = allObjects.filter(o => {
        const rules = (o.userData && o.userData.rules) ? o.userData.rules : {};
        // Ignore other zombies so they don't block each other
        return rules.collidable && !zombies.includes(o);
    });

    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0) return;
        if (zombie.userData.mixer) {
            zombie.userData.mixer.update(delta);
        }

        let moving = false;

        // Apply knockback velocity if present
        if (zombie.userData.knockback) {
            const kb = zombie.userData.knockback;
            if (kb.lengthSq() > 0.0001) {
                const proposed = zombie.position.clone().addScaledVector(kb, delta);
                if (!checkZombieCollision(zombie, proposed, collidableObjects)) {
                    zombie.position.copy(proposed);
                }
                kb.multiplyScalar(Math.max(0, 1 - 5 * delta));
                moving = true;
            }
        }

        // Hunt the player if within spotting distance
        const toPlayer = new THREE.Vector3().subVectors(playerObj.position, zombie.position);
        const distToPlayer = Math.hypot(toPlayer.x, toPlayer.z);
        const spotRange = zombie.userData.spotDistance || 8;

        if (distToPlayer <= spotRange) {
            // Move directly toward the player
            const dir = toPlayer.setY(0).normalize();
            const proposed = zombie.position.clone().addScaledVector(dir, zombie.userData.speed);
            if (!checkZombieCollision(zombie, proposed, collidableObjects)) {
                zombie.position.copy(proposed);
                const targetRot = Math.atan2(dir.x, dir.z);
                const currentRot = zombie.rotation.y;
                const rotDiff = THREE.MathUtils.euclideanModulo(targetRot - currentRot + Math.PI, Math.PI * 2) - Math.PI;
                const turnSpeed = zombie.userData.turnSpeed || 5;
                zombie.rotation.y = currentRot + rotDiff * Math.min(1, turnSpeed * delta);
                moving = true;
            }
            // Reset wandering so the zombie continues to chase
            zombie.userData._wanderTime = 0;
        } else {
            // Wander randomly when the player is not nearby
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
                // Rotate smoothly to face the direction of movement
                const targetRot = Math.atan2(
                    zombie.userData._wanderDir.x,
                    zombie.userData._wanderDir.z
                );
                const currentRot = zombie.rotation.y;
                const rotDiff = THREE.MathUtils.euclideanModulo(targetRot - currentRot + Math.PI, Math.PI * 2) - Math.PI;
                const turnSpeed = zombie.userData.turnSpeed || 5;
                zombie.rotation.y = currentRot + rotDiff * Math.min(1, turnSpeed * delta);
                moving = true;
            } else {
                zombie.userData._wanderTime = 0; // pick new direction next frame
            }
            zombie.userData._wanderTime -= delta;
        }

        // Prevent zombies from stacking by nudging them away from
        // each other when they get too close. This keeps a small
        // separation between zombies while still allowing them to
        // chase the player.
        const mySize = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
            ? zombie.userData.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;
        zombies.forEach(other => {
            if (other === zombie || other.userData.hp <= 0) return;
            const otherSize = (other.userData && other.userData.rules && other.userData.rules.geometry)
                ? other.userData.rules.geometry
                : DEFAULT_ZOMBIE_SIZE;
            const minDist = (mySize[0] + otherSize[0]) / 2;
            const offset = new THREE.Vector3().subVectors(zombie.position, other.position);
            const dist = Math.hypot(offset.x, offset.z);
            if (dist > 0 && dist < minDist) {
                const push = offset.setY(0).normalize().multiplyScalar((minDist - dist) * 0.5);
                const proposed = zombie.position.clone().add(push);
                if (!checkZombieCollision(zombie, proposed, collidableObjects)) {
                    zombie.position.copy(proposed);
                }
            }
        });

        // Reduce attack cooldown timer
        zombie.userData._hitTimer = Math.max((zombie.userData._hitTimer || 0) - delta, 0);

        // Player collision
        const size = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
            ? zombie.userData.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;
        const zCenter = new THREE.Vector3(zombie.position.x, zombie.position.y + size[1] / 2, zombie.position.z);
        const zBox = new THREE.Box3().setFromCenterAndSize(zCenter, new THREE.Vector3(...size));
        const pCenter = new THREE.Vector3(playerObj.position.x, 1.6, playerObj.position.z);
        const pBox = new THREE.Box3().setFromCenterAndSize(pCenter, new THREE.Vector3(0.5, 1.6, 0.5));
        if (pBox.intersectsBox(zBox) && zombie.userData._hitTimer === 0) {
            const angle = Math.random() * Math.PI * 2;
            const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));

            // Move the player far enough so their bounding box no longer
            // overlaps the zombie. We also exclude the zombie itself from
            // the collision check so that the player can be nudged out of
            // an overlapping state.
            const zombieHalf = size[0] / 2;
            const playerHalf = 0.5 / 2;
            const DIST = zombieHalf + playerHalf + 0.05; // small buffer
            const target = playerObj.position.clone().addScaledVector(dir, DIST);

            const others = collidableObjects.filter(obj => obj !== zombie);
            if (!checkPlayerCollision(target, others)) {
                playerObj.position.copy(target);
            }

            if (onPlayerHit) onPlayerHit(dir.clone());
            zombie.userData._hitTimer = zombie.userData.attackCooldown || 1;
        }

        setZombieAnimation(zombie, moving);
    });
}

// Damage zombie and apply knockback/animation reset
export function damageZombie(zombie, dmg, hitDir) {
    // Reduce health
    zombie.userData.hp -= dmg;

    // Apply a knockback impulse with some directional randomness
    if (hitDir) {
        const dir = hitDir.clone().setY(0).normalize();
        const offset = THREE.MathUtils.degToRad(Math.random() * 150 - 75);
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), offset);
        const kb = dir.multiplyScalar(6);
        if (!zombie.userData.knockback) {
            zombie.userData.knockback = new THREE.Vector3();
        }
        zombie.userData.knockback.add(kb);
    }

    // Reset animation so the zombie visibly reacts
    if (zombie.userData._movingAction) {
        zombie.userData._movingAction.stop();
        zombie.userData._movingAction.reset().play();
        zombie.userData._actionPlaying = true;
    }

    // Hide zombie if out of health
    if (zombie.userData.hp <= 0) {
        zombie.visible = false; // or play anim/remove
    }
}

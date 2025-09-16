// zombie.js

import { getLoadedObjects, getAllObjects } from './mapLoader.js';

let zombies = [];
let zombieTypeIds = null;
const DEFAULT_ZOMBIE_SIZE = [0.7, 1.8, 0.7];
// Small shrink to make collision boxes less tight so zombies can squeeze
// through narrow corridors without getting stuck on walls.
const ZOMBIE_COLLISION_MARGIN = 0.1;
// Zombies beyond this distance from the player are neither rendered nor updated.
// This reduces CPU/GPU workload when many zombies exist far from the action.
// Maximum radius around the player where zombies remain active
const ZOMBIE_ACTIVE_DISTANCE = 20;

let zombieModelsCache = {};
let zombieMaterialsCache = {};
const zombieRules = new Map();
const zombieGeometryCache = new Map();
let zombieDefinitionsMap = null;
let zombieDefinitionsPromise = null;

// Blood effect handling
const bloodEffects = [];
let bloodEffectModel = null;
if (THREE?.GLTFLoader) {
    const bloodLoader = new THREE.GLTFLoader();
    bloodLoader.load('models/blood_effect.glb', gltf => {
        bloodEffectModel = gltf.scene;
    });
}

// Track the most recent gunshot so zombies can react to noise
let lastGunshot = null;
export function registerGunshot(position) {
    lastGunshot = {
        position: position.clone(),
        time: performance.now() / 1000
    };
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

function cacheZombieAssets(models, materials) {
    if (models) zombieModelsCache = models;
    if (materials) zombieMaterialsCache = materials;
}

function rememberZombieRule(type, rule) {
    if (!type || !rule) return;
    zombieRules.set(type, rule);
}

function buildRuleFromDefinition(definition) {
    if (!definition) return null;
    return {
        collidable: definition.collidable === true,
        model: definition.model || null,
        ai: true,
        geometry: definition.size ? definition.size.slice() : DEFAULT_ZOMBIE_SIZE.slice(),
        color: definition.color || '#999999',
        texture: definition.texture || null
    };
}

async function loadZombieDefinitions() {
    if (zombieDefinitionsMap) return zombieDefinitionsMap;
    if (!zombieDefinitionsPromise) {
        zombieDefinitionsPromise = fetch('zombies.json')
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
            .then(defs => {
                zombieDefinitionsMap = new Map();
                defs.forEach(def => {
                    if (def && def.id) {
                        zombieDefinitionsMap.set(def.id, def);
                    }
                });
                return zombieDefinitionsMap;
            });
    }
    return zombieDefinitionsPromise;
}

async function getZombieDefinition(type) {
    if (!type) return null;
    const defs = await loadZombieDefinitions();
    return defs.get(type) || null;
}

async function resolveZombieRule(type, fallbackRule = null) {
    if (fallbackRule) {
        rememberZombieRule(type, fallbackRule);
        return fallbackRule;
    }
    if (type && zombieRules.has(type)) {
        return zombieRules.get(type);
    }
    const def = await getZombieDefinition(type);
    const rule = buildRuleFromDefinition(def);
    if (rule) rememberZombieRule(type, rule);
    return rule;
}

function ensureModelScale(zombieMesh, type, rule) {
    const modelEntry = type ? zombieModelsCache[type] : null;
    if (!modelEntry || !modelEntry.scene) return;

    const targetSize = (rule && rule.geometry) ? rule.geometry : DEFAULT_ZOMBIE_SIZE;

    if (!modelEntry._size) {
        const src = modelEntry.scene;
        src.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(src);
        const size = new THREE.Vector3();
        box.getSize(size);
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
        modelEntry._size = size;
    }

    const size = modelEntry._size;
    if (size && size.x > 0 && size.y > 0 && size.z > 0) {
        zombieMesh.scale.set(
            targetSize[0] / size.x,
            targetSize[1] / size.y,
            targetSize[2] / size.z
        );
    }
}

function ensureZombieAnimations(zombieMesh, type) {
    const modelEntry = type ? zombieModelsCache[type] : null;
    if (!modelEntry || !Array.isArray(modelEntry.animations) || modelEntry.animations.length === 0) {
        return;
    }

    const mixer = new THREE.AnimationMixer(zombieMesh);
    const actions = {};
    modelEntry.animations.forEach(clip => {
        actions[clip.name] = mixer.clipAction(clip);
    });

    zombieMesh.userData.mixer = mixer;
    zombieMesh.userData.actions = actions;
    zombieMesh.userData._actionPlaying = false;
}

function applyZombieStats(zombieMesh, definition = null) {
    const ud = zombieMesh.userData || (zombieMesh.userData = {});
    const def = definition || {};
    if (def.aggro_range !== undefined && ud.aggro_range === undefined) {
        ud.aggro_range = def.aggro_range;
    }
    ud.hp = ud.hp ?? def.hp ?? 10;
    ud.spotDistance = ud.spotDistance ?? def.spotDistance ?? ud.aggro_range ?? 8;
    ud.speed = ud.speed ?? def.speed ?? 0.01;
    ud.attackCooldown = ud.attackCooldown ?? def.attackCooldown ?? 1;
    ud.turnSpeed = ud.turnSpeed ?? def.turnSpeed ?? 5;
}

function createFallbackZombieMesh(type, rule) {
    const size = (rule && rule.geometry) ? rule.geometry : DEFAULT_ZOMBIE_SIZE;
    if (!zombieGeometryCache.has(type)) {
        zombieGeometryCache.set(type, new THREE.BoxGeometry(...size));
    }
    const geometry = zombieGeometryCache.get(type);

    let material;
    if (type && zombieMaterialsCache && zombieMaterialsCache[type]) {
        material = zombieMaterialsCache[type].clone();
    } else {
        const color = (rule && rule.color) ? rule.color : '#44ff44';
        material = new THREE.MeshLambertMaterial({ color });
    }
    return new THREE.Mesh(geometry, material);
}

function toVector3(pos) {
    if (!pos) return null;
    if (pos.isVector3) return pos.clone();
    if (Array.isArray(pos)) {
        return new THREE.Vector3(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    }
    if (typeof pos === 'object' && 'x' in pos && 'z' in pos) {
        return new THREE.Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
    }
    return null;
}

async function buildZombieMesh({ type, position, rotation = 0, rule = null, template = null }) {
    const resolvedRule = await resolveZombieRule(type, rule);
    const definition = await getZombieDefinition(type);
    const pos = toVector3(position) || new THREE.Vector3();

    let zombieMesh = null;
    const modelEntry = type ? zombieModelsCache[type] : null;
    if (modelEntry && modelEntry.scene) {
        zombieMesh = cloneSkinned(modelEntry.scene);
    } else if (template) {
        zombieMesh = template;
    } else {
        zombieMesh = createFallbackZombieMesh(type || 'fallback', resolvedRule);
    }

    zombieMesh.position.copy(pos);
    zombieMesh.rotation.y = rotation || 0;
    zombieMesh.userData = {
        ...(template ? template.userData || {} : {}),
        type,
        ai: true,
        rules: resolvedRule || (zombieMesh.userData && zombieMesh.userData.rules) || buildRuleFromDefinition(definition) || {
            geometry: DEFAULT_ZOMBIE_SIZE.slice(),
            collidable: true,
            ai: true
        }
    };

    ensureModelScale(zombieMesh, type, zombieMesh.userData.rules);
    ensureZombieAnimations(zombieMesh, type);
    applyZombieStats(zombieMesh, definition);
    zombieMesh.userData._lastValidPos = zombieMesh.position.clone();

    rememberZombieRule(type, zombieMesh.userData.rules);

    return { mesh: zombieMesh, usedTemplate: zombieMesh === template };
}

// Loads zombies from map objects (Mesh-based!)
export async function spawnZombiesFromMap(scene, mapObjects, models, materials) {
    cacheZombieAssets(models, materials);
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

        const rotationY = obj.rotation ? obj.rotation.y : 0;
        const { mesh: zombieMesh, usedTemplate } = await buildZombieMesh({
            type: objType,
            position: obj.position,
            rotation: rotationY,
            rule: obj.userData ? obj.userData.rules : null,
            template: obj
        });

        if (!zombieMesh) continue;

        if (!usedTemplate && obj.parent) {
            obj.parent.remove(obj);
        }

        if (!usedTemplate) {
            scene.add(zombieMesh);
        }

        mapObjects[i] = zombieMesh;

        zombieMesh.userData.hp = zombieMesh.userData.hp ?? 10;
        zombieMesh.userData.spotDistance = zombieMesh.userData.spotDistance ?? zombieMesh.userData.aggro_range ?? 8;
        zombieMesh.userData.speed = zombieMesh.userData.speed ?? 0.01;
        zombieMesh.userData.attackCooldown = zombieMesh.userData.attackCooldown ?? 1;
        zombieMesh.userData.turnSpeed = zombieMesh.userData.turnSpeed ?? 5;
        zombieMesh.userData.ai = true;
        zombies.push(zombieMesh);
    }
}

export async function spawnRandomZombies(scene, count, walkablePositions = []) {
    if (!scene || !count || count <= 0) return [];
    if (!Array.isArray(walkablePositions) || walkablePositions.length === 0) return [];

    await loadZombieDefinitions();
    const idsFromDefs = zombieDefinitionsMap ? Array.from(zombieDefinitionsMap.keys()) : [];
    const idsFromRules = Array.from(zombieRules.keys());
    const zombieIds = Array.from(new Set([...idsFromDefs, ...idsFromRules])).filter(Boolean);
    if (zombieIds.length === 0) return [];

    const collidableObjects = getAllObjects().filter(obj => {
        const rules = (obj.userData && obj.userData.rules) ? obj.userData.rules : {};
        return rules.collidable && !zombies.includes(obj);
    });

    const spawned = [];
    const occupied = new Set();
    let attempts = 0;
    const maxAttempts = Math.max(count * 5, walkablePositions.length * 2);

    while (spawned.length < count && attempts < maxAttempts) {
        attempts++;
        const candidateRaw = walkablePositions[Math.floor(Math.random() * walkablePositions.length)];
        const candidatePos = toVector3(candidateRaw);
        if (!candidatePos) continue;

        const key = `${candidatePos.x.toFixed(3)}|${candidatePos.y.toFixed(3)}|${candidatePos.z.toFixed(3)}`;
        if (occupied.has(key)) continue;

        const type = zombieIds[Math.floor(Math.random() * zombieIds.length)];
        const { mesh: zombieMesh } = await buildZombieMesh({
            type,
            position: candidatePos,
            rotation: Math.random() * Math.PI * 2
        });

        if (!zombieMesh) continue;

        const colliders = collidableObjects.concat(zombies, spawned);
        if (checkZombieCollision(zombieMesh, zombieMesh.position, colliders)) {
            continue;
        }

        scene.add(zombieMesh);
        zombies.push(zombieMesh);
        spawned.push(zombieMesh);
        occupied.add(key);
    }

    return spawned;
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

// Retrieve a cached world-space bounding box for an object. The box is
// recomputed only if the object's transform has changed since the last
// time it was requested.
function getCachedBox(obj) {
    const ud = obj.userData || (obj.userData = {});
    if (!ud._bbox) {
        obj.updateMatrixWorld(true);
        ud._bbox = new THREE.Box3().setFromObject(obj);
        ud._bboxPos = obj.position.clone();
        ud._bboxQuat = obj.quaternion.clone();
        ud._bboxScale = obj.scale.clone();
    } else if (
        !ud._bboxPos.equals(obj.position) ||
        !ud._bboxQuat.equals(obj.quaternion) ||
        !ud._bboxScale.equals(obj.scale)
    ) {
        obj.updateMatrixWorld(true);
        ud._bbox.setFromObject(obj);
        ud._bboxPos.copy(obj.position);
        ud._bboxQuat.copy(obj.quaternion);
        ud._bboxScale.copy(obj.scale);
    }
    return ud._bbox;
}

// Simple collision check for zombies using loaded map objects
function checkZombieCollision(zombie, proposed, collidables) {
    const size = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
        ? zombie.userData.rules.geometry
        : DEFAULT_ZOMBIE_SIZE;
    const center = new THREE.Vector3(proposed.x, proposed.y + size[1] / 2, proposed.z);
    const boxSize = new THREE.Vector3(
        size[0] - ZOMBIE_COLLISION_MARGIN,
        size[1],
        size[2] - ZOMBIE_COLLISION_MARGIN
    );
    const box = new THREE.Box3().setFromCenterAndSize(center, boxSize);
    for (const obj of collidables) {
        if (obj === zombie) continue;
        const objBox = getCachedBox(obj);
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
        const box = getCachedBox(obj);
        if (playerBox.intersectsBox(box)) return true;
    }
    return false;
}

// Attempt to move zombie while allowing sliding along walls
function tryMove(zombie, displacement, collidables) {
    const target = zombie.position.clone().add(displacement);
    if (!checkZombieCollision(zombie, target, collidables)) {
        zombie.position.copy(target);
        return true;
    }

    let moved = false;
    if (displacement.x) {
        const tx = zombie.position.clone().add(new THREE.Vector3(displacement.x, 0, 0));
        if (!checkZombieCollision(zombie, tx, collidables)) {
            zombie.position.x = tx.x;
            moved = true;
        }
    }
    if (displacement.z) {
        const tz = zombie.position.clone().add(new THREE.Vector3(0, 0, displacement.z));
        if (!checkZombieCollision(zombie, tz, collidables)) {
            zombie.position.z = tz.z;
            moved = true;
        }
    }
    return moved;
}

// When a zombie becomes active again, ensure it isn't spawning inside
// a wall or other static object. We attempt to push it out along the
// smallest penetration axis; if that fails, revert to its last valid
// position.
function resolveZombieOverlap(zombie, collidables) {
    if (!checkZombieCollision(zombie, zombie.position, collidables)) return;

    const size = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
        ? zombie.userData.rules.geometry
        : DEFAULT_ZOMBIE_SIZE;
    const center = new THREE.Vector3(zombie.position.x, zombie.position.y + size[1] / 2, zombie.position.z);
    const zBox = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(...size));

    let resolved = false;
    for (const obj of collidables) {
        const objBox = getCachedBox(obj);
        if (!zBox.intersectsBox(objBox)) continue;

        const overlapX = Math.min(zBox.max.x, objBox.max.x) - Math.max(zBox.min.x, objBox.min.x);
        const overlapZ = Math.min(zBox.max.z, objBox.max.z) - Math.max(zBox.min.z, objBox.min.z);

        if (overlapX < overlapZ) {
            const dir = (zBox.getCenter(new THREE.Vector3()).x < objBox.getCenter(new THREE.Vector3()).x) ? -overlapX : overlapX;
            zombie.position.x += dir;
        } else {
            const dir = (zBox.getCenter(new THREE.Vector3()).z < objBox.getCenter(new THREE.Vector3()).z) ? -overlapZ : overlapZ;
            zombie.position.z += dir;
        }
        resolved = true;
        break;
    }

    if (resolved && checkZombieCollision(zombie, zombie.position, collidables)) {
        const lastPos = zombie.userData && zombie.userData._lastValidPos;
        if (lastPos) zombie.position.copy(lastPos);
    }
}

// Update zombies: handle animation and simple wandering movement
export function updateZombies(delta, playerObj, onPlayerHit, playerState = {}) {
    const { isSneaking = false } = playerState;
    const allObjects = getLoadedObjects();
    const collidableObjects = allObjects.filter(o => {
        const rules = (o.userData && o.userData.rules) ? o.userData.rules : {};
        // Ignore other zombies so they don't block each other
        return rules.collidable && !zombies.includes(o);
    });

    // Clear old gunshot data after a few seconds
    const now = performance.now() / 1000;
    if (lastGunshot && now - lastGunshot.time > 3) {
        lastGunshot = null;
    }

    // Build a spatial grid of active zombies to limit neighbor checks
    let gridCell = DEFAULT_ZOMBIE_SIZE[0];
    zombies.forEach(z => {
        const size = (z.userData && z.userData.rules && z.userData.rules.geometry)
            ? z.userData.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;
        gridCell = Math.max(gridCell, size[0]);
    });

    const grid = new Map();
    const cellKey = (x, z) => `${x},${z}`;

    // Insert a zombie into the grid and track its cell on the object
    const insertZombie = z => {
        const cx = Math.floor(z.position.x / gridCell);
        const cz = Math.floor(z.position.z / gridCell);
        z.userData._cellX = cx;
        z.userData._cellZ = cz;
        const key = cellKey(cx, cz);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(z);
    };
    zombies.forEach(z => {
        if (z.userData.hp <= 0) return;
        const wasInactive = !z.visible;
        const dist = z.position.distanceTo(playerObj.position);
        if (dist > ZOMBIE_ACTIVE_DISTANCE) {
            z.visible = false;
            return;
        }
        z.visible = true;
        if (wasInactive) {
            resolveZombieOverlap(z, collidableObjects);
        }
        insertZombie(z);
    });

    // Update a zombie's grid cell when it moves
    const updateCell = z => {
        const cx = Math.floor(z.position.x / gridCell);
        const cz = Math.floor(z.position.z / gridCell);
        if (cx === z.userData._cellX && cz === z.userData._cellZ) {
            return { cx, cz };
        }
        const oldKey = cellKey(z.userData._cellX, z.userData._cellZ);
        const oldArr = grid.get(oldKey);
        if (oldArr) {
            const idx = oldArr.indexOf(z);
            if (idx !== -1) oldArr.splice(idx, 1);
            if (oldArr.length === 0) grid.delete(oldKey);
        }
        const newKey = cellKey(cx, cz);
        if (!grid.has(newKey)) grid.set(newKey, []);
        grid.get(newKey).push(z);
        z.userData._cellX = cx;
        z.userData._cellZ = cz;
        return { cx, cz };
    };

    zombies.forEach(zombie => {
        if (zombie.userData.hp <= 0 || !zombie.visible) return;
        if (zombie.userData.mixer) {
            zombie.userData.mixer.update(delta);
        }

        let moving = false;

        // Apply knockback velocity if present
        if (zombie.userData.knockback) {
            const kb = zombie.userData.knockback;
            if (kb.lengthSq() > 0.0001) {
                const displacement = kb.clone().multiplyScalar(delta);
                tryMove(zombie, displacement, collidableObjects);
                kb.multiplyScalar(Math.max(0, 1 - 5 * delta));
                moving = true;
            }
        }

        // Check for nearby gunshots and trigger temporary aggro
        const baseSpotRange = zombie.userData.spotDistance || 8;
        // Sneaking halves the distance at which zombies can spot the player.
        const spotRangeMultiplier = isSneaking ? 0.5 : 1;
        const spotRange = baseSpotRange * spotRangeMultiplier;
        if (lastGunshot && zombie.position.distanceTo(lastGunshot.position) <= spotRange) {
            // Become aggressive toward the player for 3-10 seconds
            zombie.userData._aggroTime = 3 + Math.random() * 7;
        }
        zombie.userData._aggroTime = Math.max(0, (zombie.userData._aggroTime || 0) - delta);

        // Hunt the player if within spotting distance or temporarily aggroed
        const toPlayer = new THREE.Vector3().subVectors(playerObj.position, zombie.position);
        const distToPlayer = Math.hypot(toPlayer.x, toPlayer.z);

        if (distToPlayer <= spotRange || zombie.userData._aggroTime > 0) {
            // Move directly toward the player
            const dir = toPlayer.setY(0).normalize();
            const displacement = dir.clone().multiplyScalar(zombie.userData.speed);
            if (tryMove(zombie, displacement, collidableObjects)) {
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
            const displacement = zombie.userData._wanderDir.clone().multiplyScalar(zombie.userData.speed * 0.5);
            if (tryMove(zombie, displacement, collidableObjects)) {
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
        // chase the player. Use a spatial grid to only compare nearby zombies.
        const mySize = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
            ? zombie.userData.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;

        // Ensure the grid cell reflects the zombie's current position
        const { cx, cz } = updateCell(zombie);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = cellKey(cx + dx, cz + dz);
                const cell = grid.get(key);
                if (!cell) continue;
                cell.forEach(other => {
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
            }
        }

        // Update cell again in case separation pushed the zombie elsewhere
        updateCell(zombie);

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
        zombie.userData._lastValidPos = zombie.position.clone();
    });
}

// Damage zombie and apply knockback/animation reset
export function damageZombie(zombie, dmg, hitDir, hitPos) {
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

    // Spawn blood effect at the impact point
    spawnBloodEffect(zombie, hitPos);

    // Reset animation so the zombie visibly reacts
    if (zombie.userData._movingAction) {
        zombie.userData._movingAction.stop();
        zombie.userData._movingAction.reset().play();
        zombie.userData._actionPlaying = true;
    }

    // Handle death: keep corpse, lay it down, and notify listeners
    if (zombie.userData.hp <= 0 && !zombie.userData._dead) {
        zombie.userData._dead = true;
        // Spawn repeated bursts of larger blood effects when the zombie dies
        const bursts = 3;
        const delay = 100; // ms between bursts
        for (let b = 0; b < bursts; b++) {
            setTimeout(() => {
                for (let i = 0; i < 20; i++) {
                    const scaleMultiplier = 10 + Math.random() * 10; // 10-20 times larger
                    const offsetRange = 0.00254; // ~0.1 inch
                    const offset = new THREE.Vector3(
                        (Math.random() - 0.5) * 2 * offsetRange,
                        0,
                        (Math.random() - 0.5) * 2 * offsetRange
                    );
                    const pos = zombie.position.clone().add(offset);
                    spawnBloodEffect(zombie, pos, scaleMultiplier);
                }
            }, b * delay);
        }

        // Rotate the zombie so the body lies flat on the ground
        zombie.rotation.x = -Math.PI / 2;

        // Keep the corpse on the floor instead of sinking below it.
        // The zombie's y-position already represents ground level, so no
        // additional offset is needed when laying it down.

        // Emit an event so the main game can react (screen shake, etc.)
        window.dispatchEvent(new CustomEvent('zombieKilled', { detail: { zombie } }));
    }
}

// Spawn a blood effect that flies away from the zombie
// starting from the impact point and moving in a random direction
function spawnBloodEffect(zombie, hitPos, sizeMultiplier = 1) {
    if (!bloodEffectModel || !zombie.parent) return;

    const effect = bloodEffectModel.clone(true);

    const size = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
        ? zombie.userData.rules.geometry
        : DEFAULT_ZOMBIE_SIZE;

    const baseFactor = 1 / (3 + Math.random() * 9); // 3-12 times smaller
    const factor = baseFactor * sizeMultiplier;
    effect.scale.set(size[0] * factor, size[1] * factor, size[2] * factor);

    if (hitPos) {
        effect.position.copy(hitPos);
    } else {
        effect.position.copy(zombie.position);
    }

    const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
    ).normalize();
    const speed = 1; // units per second
    const maxDist = 0.0061 + Math.random() * (0.0305 - 0.0061); // 0.02-0.1 ft in meters
    bloodEffects.push({
        mesh: effect,
        velocity: dir.multiplyScalar(speed),
        life: 0,
        maxLife: maxDist / speed
    });

    zombie.parent.add(effect);
}

// Update active blood effects
export function updateBloodEffects(delta) {
    for (let i = bloodEffects.length - 1; i >= 0; i--) {
        const eff = bloodEffects[i];
        eff.mesh.position.addScaledVector(eff.velocity, delta);
        eff.life += delta;
        if (eff.life >= eff.maxLife) {
            eff.mesh.parent?.remove(eff.mesh);
            bloodEffects.splice(i, 1);
        }
    }
}

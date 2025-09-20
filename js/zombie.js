// zombie.js

import { getLoadedObjects, getAllObjects, getSafeZones } from './mapLoader.js';

let zombies = [];
let zombieTypeIds = null;
let loadingManager = THREE.DefaultLoadingManager;
const DEFAULT_ZOMBIE_SIZE = [0.7, 1.8, 0.7];
// Small shrink to make collision boxes less tight so zombies can squeeze
// through narrow corridors without getting stuck on walls.
const ZOMBIE_COLLISION_MARGIN = 0.1;
// Base radius around the player where zombies remain active before
// performance-based scaling is applied.
const DEFAULT_BASE_ZOMBIE_ACTIVE_DISTANCE = 20;
const MIN_BASE_ZOMBIE_ACTIVE_DISTANCE = 8;
const MAX_BASE_ZOMBIE_ACTIVE_DISTANCE = 40;
const TARGET_FRAME_TIME = 1 / 60;
const MIN_PERFORMANCE_FACTOR = 0.3;
const ACTIVE_DISTANCE_SMOOTHING = 8;
let baseZombieActiveDistance = DEFAULT_BASE_ZOMBIE_ACTIVE_DISTANCE;
let smoothedZombieActiveDistance = baseZombieActiveDistance;
let zombieSettingsUI = null;
let lastDisplayedBaseDistance = null;
let lastDisplayedEffectiveDistance = null;
const storedBaseActiveDistance = readStoredBaseZombieActiveDistance();
if (storedBaseActiveDistance !== null) {
    baseZombieActiveDistance = storedBaseActiveDistance;
    smoothedZombieActiveDistance = storedBaseActiveDistance;
}
const CORPSE_SINK_DURATION = 10; // seconds before a corpse disappears
const CORPSE_FLOAT_DELAY = 3; // delay before corpse begins descending
const CORPSE_SINK_DISTANCE_MULTIPLIER = 1; // sink by one body height

let zombieModelsCache = {};
let zombieMaterialsCache = {};
const zombieRules = new Map();
const zombieGeometryCache = new Map();
let zombieDefinitionsMap = null;
let zombieDefinitionsPromise = null;

const COIN_DROP_CHANCE = 0.2;
const COIN_VALUE = 1;

export function registerLoadingManager(manager) {
    loadingManager = manager || THREE.DefaultLoadingManager;
}

export function clearZombies(scene) {
    zombies.forEach(zombie => {
        if (!zombie) return;
        if (scene) {
            if (zombie.parent === scene) {
                scene.remove(zombie);
            }
        } else if (zombie.parent) {
            zombie.parent.remove(zombie);
        }
    });
    zombies = [];
    zombieGrid.clear();
    bloodEffects.forEach(effect => {
        effect.mesh?.parent?.remove(effect.mesh);
    });
    bloodEffects.length = 0;
    lastGunshot = null;
}

// Persistent spatial grid used to keep zombies separated.
const zombieGrid = new Map();
let zombieGridCellSize = Math.max(DEFAULT_ZOMBIE_SIZE[0], DEFAULT_ZOMBIE_SIZE[2]);

function cellKey(x, z) {
    return `${x},${z}`;
}

function getZombieGeometry(zombie) {
    const geometry = zombie?.userData?.rules?.geometry;
    if (Array.isArray(geometry) && geometry.length >= 3) {
        return geometry;
    }
    return DEFAULT_ZOMBIE_SIZE;
}

function computeZombieGridCellSize() {
    let size = Math.max(DEFAULT_ZOMBIE_SIZE[0], DEFAULT_ZOMBIE_SIZE[2]);
    zombies.forEach(zombie => {
        const geometry = getZombieGeometry(zombie);
        size = Math.max(size, geometry[0] || size, geometry[2] || size);
    });
    return size || DEFAULT_ZOMBIE_SIZE[0];
}

function addZombieToGrid(zombie, cx, cz) {
    if (!zombie.userData) zombie.userData = {};
    const key = cellKey(cx, cz);
    let bucket = zombieGrid.get(key);
    if (!bucket) {
        bucket = [];
        zombieGrid.set(key, bucket);
    }
    bucket.push(zombie);
    zombie.userData._cellX = cx;
    zombie.userData._cellZ = cz;
    zombie.userData._inGrid = true;
}

function removeZombieFromGrid(zombie) {
    if (!zombie || !zombie.userData || !zombie.userData._inGrid) return;
    const key = cellKey(zombie.userData._cellX, zombie.userData._cellZ);
    const bucket = zombieGrid.get(key);
    if (bucket) {
        const idx = bucket.indexOf(zombie);
        if (idx !== -1) bucket.splice(idx, 1);
        if (bucket.length === 0) zombieGrid.delete(key);
    }
    delete zombie.userData._cellX;
    delete zombie.userData._cellZ;
    zombie.userData._inGrid = false;
}

function updateZombieGridCell(zombie, force = false) {
    if (!zombie || !zombie.userData) {
        return { cx: undefined, cz: undefined };
    }
    if (zombie.userData.hp <= 0 || !zombie.visible) {
        removeZombieFromGrid(zombie);
        return { cx: undefined, cz: undefined };
    }

    const cx = Math.floor(zombie.position.x / zombieGridCellSize);
    const cz = Math.floor(zombie.position.z / zombieGridCellSize);

    if (!force && zombie.userData._inGrid && zombie.userData._cellX === cx && zombie.userData._cellZ === cz) {
        return { cx, cz };
    }

    removeZombieFromGrid(zombie);
    addZombieToGrid(zombie, cx, cz);
    return { cx, cz };
}

function rebuildZombieGrid() {
    zombieGrid.clear();
    zombieGridCellSize = computeZombieGridCellSize();
    zombies.forEach(zombie => {
        if (!zombie.userData) zombie.userData = {};
        zombie.userData._inGrid = false;
        delete zombie.userData._cellX;
        delete zombie.userData._cellZ;
        if (zombie.userData.hp <= 0 || !zombie.visible) return;
        const cx = Math.floor(zombie.position.x / zombieGridCellSize);
        const cz = Math.floor(zombie.position.z / zombieGridCellSize);
        addZombieToGrid(zombie, cx, cz);
    });
}

function getSafeZoneList() {
    const zones = getSafeZones();
    return Array.isArray(zones) ? zones : [];
}

export function getZombieBoundingBox(zombie, position, includeMargin = true) {
    const geometry = getZombieGeometry(zombie);
    const width = (geometry?.[0] ?? DEFAULT_ZOMBIE_SIZE[0]) || DEFAULT_ZOMBIE_SIZE[0];
    const height = (geometry?.[1] ?? DEFAULT_ZOMBIE_SIZE[1]) || DEFAULT_ZOMBIE_SIZE[1];
    const depth = (geometry?.[2] ?? DEFAULT_ZOMBIE_SIZE[2]) || DEFAULT_ZOMBIE_SIZE[2];
    const margin = includeMargin ? ZOMBIE_COLLISION_MARGIN : 0;
    const boxSize = new THREE.Vector3(
        Math.max(width - margin, 0.01),
        Math.max(height, 0.01),
        Math.max(depth - margin, 0.01)
    );
    const centerY = (position?.y ?? 0) + (boxSize.y / 2);
    const center = new THREE.Vector3(position?.x ?? 0, centerY, position?.z ?? 0);
    return new THREE.Box3().setFromCenterAndSize(center, boxSize);
}

function zoneContainsPoint(zone, point) {
    if (!zone || !point) return false;
    const minY = Number.isFinite(zone.minY) ? zone.minY : -Infinity;
    const maxY = Number.isFinite(zone.maxY) ? zone.maxY : Infinity;
    const y = point.y ?? 0;
    return (
        point.x >= zone.minX &&
        point.x <= zone.maxX &&
        point.z >= zone.minZ &&
        point.z <= zone.maxZ &&
        y >= minY &&
        y <= maxY
    );
}

function zoneIntersectsBox(zone, box) {
    if (!zone || !box) return false;
    const minY = Number.isFinite(zone.minY) ? zone.minY : -Infinity;
    const maxY = Number.isFinite(zone.maxY) ? zone.maxY : Infinity;
    if (box.max.x <= zone.minX || box.min.x >= zone.maxX) return false;
    if (box.max.z <= zone.minZ || box.min.z >= zone.maxZ) return false;
    if (box.max.y <= minY || box.min.y >= maxY) return false;
    return true;
}

function pointInsideAnySafeZone(point, zones = getSafeZoneList()) {
    if (!zones.length || !point) {
        return false;
    }
    for (let i = 0; i < zones.length; i++) {
        if (zoneContainsPoint(zones[i], point)) {
            return true;
        }
    }
    return false;
}

function zombieIntersectsSafeZone(zombie, position = zombie?.position, zones = getSafeZoneList()) {
    if (!zones.length || !zombie || !position) {
        return false;
    }
    const box = getZombieBoundingBox(zombie, position, false);
    for (let i = 0; i < zones.length; i++) {
        if (zoneIntersectsBox(zones[i], box)) {
            return true;
        }
    }
    return false;
}

// Blood effect handling
const bloodEffects = [];
let bloodEffectModel = null;
if (THREE?.GLTFLoader) {
    const bloodLoader = new THREE.GLTFLoader();
    bloodLoader.load('models/blood_effect.glb', gltf => {
        bloodEffectModel = gltf.scene;
    });
}

let coinModel = null;
if (THREE?.GLTFLoader) {
    const coinLoader = new THREE.GLTFLoader();
    coinLoader.load('models/coins.glb', gltf => {
        coinModel = gltf.scene;
        if (coinModel) {
            coinModel.scale.multiplyScalar(0.2);
            coinModel.updateMatrixWorld(true);
        }
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

export function initZombieSettingsUI() {
    if (typeof document === 'undefined' || zombieSettingsUI) return;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '16px';
    container.style.left = '16px';
    container.style.padding = '10px 14px';
    container.style.background = 'rgba(0, 0, 0, 0.6)';
    container.style.color = '#ffffff';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.fontSize = '13px';
    container.style.lineHeight = '1.4';
    container.style.borderRadius = '10px';
    container.style.boxShadow = '0 4px 18px rgba(0, 0, 0, 0.45)';
    container.style.backdropFilter = 'blur(5px)';
    container.style.pointerEvents = 'auto';
    container.style.zIndex = '120';
    container.style.minWidth = '220px';

    const title = document.createElement('div');
    title.textContent = 'Zombie Activity Radius';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';
    container.appendChild(title);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(MIN_BASE_ZOMBIE_ACTIVE_DISTANCE);
    slider.max = String(MAX_BASE_ZOMBIE_ACTIVE_DISTANCE);
    slider.step = '1';
    slider.value = String(baseZombieActiveDistance);
    slider.style.width = '100%';
    slider.title = 'Adjust how far away zombies remain active.';
    slider.setAttribute('aria-label', 'Zombie activity radius');
    slider.addEventListener('input', event => {
        setBaseZombieActiveDistance(Number(event.target.value));
    });
    container.appendChild(slider);

    const baseRow = document.createElement('div');
    baseRow.style.display = 'flex';
    baseRow.style.justifyContent = 'space-between';
    baseRow.style.gap = '8px';
    baseRow.style.marginTop = '8px';
    const baseLabel = document.createElement('span');
    baseLabel.textContent = 'Base radius';
    baseLabel.style.opacity = '0.75';
    const baseValue = document.createElement('span');
    baseValue.style.fontVariantNumeric = 'tabular-nums';
    baseRow.appendChild(baseLabel);
    baseRow.appendChild(baseValue);
    container.appendChild(baseRow);

    const effectiveRow = document.createElement('div');
    effectiveRow.style.display = 'flex';
    effectiveRow.style.justifyContent = 'space-between';
    effectiveRow.style.gap = '8px';
    const effectiveLabel = document.createElement('span');
    effectiveLabel.textContent = 'Effective';
    effectiveLabel.style.opacity = '0.75';
    effectiveLabel.style.marginTop = '4px';
    const effectiveValue = document.createElement('span');
    effectiveValue.style.fontVariantNumeric = 'tabular-nums';
    effectiveValue.style.marginTop = '4px';
    effectiveRow.appendChild(effectiveLabel);
    effectiveRow.appendChild(effectiveValue);
    container.appendChild(effectiveRow);

    const hint = document.createElement('div');
    hint.textContent = 'Lower values improve performance at the cost of distant activity.';
    hint.style.opacity = '0.65';
    hint.style.fontSize = '12px';
    hint.style.marginTop = '8px';
    container.appendChild(hint);

    document.body.appendChild(container);

    zombieSettingsUI = {
        container,
        slider,
        baseValue,
        effectiveValue
    };
    lastDisplayedBaseDistance = null;
    lastDisplayedEffectiveDistance = null;
    updateZombieSettingsDisplay(smoothedZombieActiveDistance);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function readStoredBaseZombieActiveDistance() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return null;
        }
        const raw = window.localStorage.getItem('zombieActiveDistanceBase');
        if (raw === null) return null;
        const parsed = parseFloat(raw);
        if (!Number.isFinite(parsed)) return null;
        return clamp(parsed, MIN_BASE_ZOMBIE_ACTIVE_DISTANCE, MAX_BASE_ZOMBIE_ACTIVE_DISTANCE);
    } catch (err) {
        console.debug('Unable to read zombie radius preference from storage:', err);
        return null;
    }
}

function persistBaseZombieActiveDistance(value) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }
        window.localStorage.setItem('zombieActiveDistanceBase', String(value));
    } catch (err) {
        console.debug('Unable to store zombie radius preference:', err);
    }
}

function setBaseZombieActiveDistance(value) {
    const numeric = Number.isFinite(value) ? value : DEFAULT_BASE_ZOMBIE_ACTIVE_DISTANCE;
    const clamped = clamp(numeric, MIN_BASE_ZOMBIE_ACTIVE_DISTANCE, MAX_BASE_ZOMBIE_ACTIVE_DISTANCE);
    baseZombieActiveDistance = clamped;
    if (smoothedZombieActiveDistance > clamped) {
        smoothedZombieActiveDistance = clamped;
    }
    persistBaseZombieActiveDistance(clamped);
    if (zombieSettingsUI?.slider && zombieSettingsUI.slider.value !== String(clamped)) {
        zombieSettingsUI.slider.value = String(clamped);
    }
    updateZombieSettingsDisplay(smoothedZombieActiveDistance);
}

function updateZombieSettingsDisplay(effectiveDistance) {
    if (!zombieSettingsUI) return;
    if (lastDisplayedBaseDistance !== baseZombieActiveDistance) {
        zombieSettingsUI.baseValue.textContent = `${Math.round(baseZombieActiveDistance)} m`;
        lastDisplayedBaseDistance = baseZombieActiveDistance;
    }
    if (typeof effectiveDistance === 'number' && Number.isFinite(effectiveDistance)) {
        if (lastDisplayedEffectiveDistance === null || Math.abs(lastDisplayedEffectiveDistance - effectiveDistance) >= 0.1) {
            zombieSettingsUI.effectiveValue.textContent = `${effectiveDistance.toFixed(1)} m`;
            lastDisplayedEffectiveDistance = effectiveDistance;
        }
    }
}

function getZombieActiveDistanceForFrame(delta) {
    const frameTime = (typeof delta === 'number' && delta > 0 && Number.isFinite(delta))
        ? delta
        : TARGET_FRAME_TIME;
    const performanceFactor = clamp(TARGET_FRAME_TIME / frameTime, MIN_PERFORMANCE_FACTOR, 1);
    const targetDistance = baseZombieActiveDistance * performanceFactor;
    const smoothing = clamp(frameTime * ACTIVE_DISTANCE_SMOOTHING, 0, 1);
    smoothedZombieActiveDistance += (targetDistance - smoothedZombieActiveDistance) * smoothing;
    const minDistance = Math.max(
        MIN_BASE_ZOMBIE_ACTIVE_DISTANCE * MIN_PERFORMANCE_FACTOR,
        baseZombieActiveDistance * MIN_PERFORMANCE_FACTOR
    );
    const maxDistance = baseZombieActiveDistance;
    smoothedZombieActiveDistance = clamp(smoothedZombieActiveDistance, minDistance, maxDistance);
    return smoothedZombieActiveDistance;
}

// Loads zombie type ids from zombies.json (async, cached)
async function getZombieTypeIds() {
    if (zombieTypeIds) return zombieTypeIds;
    const label = 'zombies.json#types';
    if (loadingManager && typeof loadingManager.itemStart === 'function') {
        loadingManager.itemStart(label);
    }
    try {
        const res = await fetch('zombies.json');
        const defs = await res.json();
        zombieTypeIds = defs.map(z => z.id);
        return zombieTypeIds;
    } catch (e) {
        return [];
    } finally {
        if (loadingManager && typeof loadingManager.itemEnd === 'function') {
            loadingManager.itemEnd(label);
        }
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
        const label = 'zombies.json#defs';
        if (loadingManager && typeof loadingManager.itemStart === 'function') {
            loadingManager.itemStart(label);
        }
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
            })
            .finally(() => {
                if (loadingManager && typeof loadingManager.itemEnd === 'function') {
                    loadingManager.itemEnd(label);
                }
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
    ud.speed = ud.speed ?? def.speed ?? 0.03;
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

        const insideSafeZone = zombieIntersectsSafeZone(zombieMesh);

        if (!usedTemplate && obj.parent) {
            obj.parent.remove(obj);
        }

        if (insideSafeZone) {
            if (zombieMesh.parent) {
                zombieMesh.parent.remove(zombieMesh);
            }
            mapObjects[i] = null;
            continue;
        }

        if (!usedTemplate) {
            scene.add(zombieMesh);
        }

        mapObjects[i] = zombieMesh;

        zombieMesh.userData.hp = zombieMesh.userData.hp ?? 10;
        zombieMesh.userData.spotDistance = zombieMesh.userData.spotDistance ?? zombieMesh.userData.aggro_range ?? 8;
        zombieMesh.userData.speed = zombieMesh.userData.speed ?? 0.03;
        zombieMesh.userData.attackCooldown = zombieMesh.userData.attackCooldown ?? 1;
        zombieMesh.userData.turnSpeed = zombieMesh.userData.turnSpeed ?? 5;
        zombieMesh.userData.ai = true;
        zombies.push(zombieMesh);
    }

    rebuildZombieGrid();
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

        if (zombieIntersectsSafeZone(zombieMesh)) {
            if (zombieMesh.parent) {
                zombieMesh.parent.remove(zombieMesh);
            }
            occupied.add(key);
            continue;
        }

        const colliders = collidableObjects.concat(zombies, spawned);
        if (checkZombieCollision(zombieMesh, zombieMesh.position, colliders)) {
            continue;
        }

        scene.add(zombieMesh);
        zombies.push(zombieMesh);
        spawned.push(zombieMesh);
        occupied.add(key);
    }

    if (spawned.length > 0) {
        rebuildZombieGrid();
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
    const collisionBox = getZombieBoundingBox(zombie, proposed, true);
    const safeZones = getSafeZoneList();
    if (safeZones.length) {
        const safeZoneBox = getZombieBoundingBox(zombie, proposed, false);
        let intersectsZone = false;
        for (let i = 0; i < safeZones.length; i++) {
            if (zoneIntersectsBox(safeZones[i], safeZoneBox)) {
                intersectsZone = true;
                break;
            }
        }
        if (intersectsZone) {
            const insideBefore = pointInsideAnySafeZone(zombie?.position, safeZones);
            if (!insideBefore) {
                return true;
            }
        }
    }
    for (const obj of collidables) {
        if (obj === zombie) continue;
        const objBox = getCachedBox(obj);
        if (collisionBox.intersectsBox(objBox)) return true;
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

function layZombieCorpseFlat(zombie) {
    if (!zombie) return;

    const ud = zombie.userData || (zombie.userData = {});

    let floorBefore = null;
    if (zombie.parent) {
        zombie.updateMatrixWorld(true);
        const preBox = new THREE.Box3().setFromObject(zombie);
        if (preBox && preBox.min && Number.isFinite(preBox.min.y)) {
            floorBefore = preBox.min.y;
        }
    }

    zombie.rotation.x = -Math.PI / 2;

    if (floorBefore !== null) {
        zombie.updateMatrixWorld(true);
        const postBox = new THREE.Box3().setFromObject(zombie);
        if (postBox && postBox.min && Number.isFinite(postBox.min.y)) {
            const offset = floorBefore - postBox.min.y;
            if (Math.abs(offset) > 1e-4) {
                zombie.position.y += offset;
                zombie.updateMatrixWorld(true);
            }
        }
    }

    ud._corpseStartY = zombie.position.y;
}

function maybeDropCoin(zombie) {
    if (!zombie || !zombie.parent) return null;
    if (!coinModel || Math.random() > COIN_DROP_CHANCE) return null;

    const coin = coinModel.clone(true);
    coin.name = 'coin';
    coin.position.copy(zombie.position);
    const groundY = zombie.userData?._corpseStartY ?? zombie.position.y ?? 0;
    coin.position.y = groundY;
    coin.rotation.y = Math.random() * Math.PI * 2;
    coin.updateMatrixWorld(true);

    const originalUserData = (coin.userData && typeof coin.userData === 'object')
        ? coin.userData
        : {};
    const userData = { ...originalUserData };
    const rules = (originalUserData.rules && typeof originalUserData.rules === 'object')
        ? { ...originalUserData.rules }
        : {};

    userData.type = 'coin';
    userData.coinValue = COIN_VALUE;
    rules.pickup = true;
    userData.rules = rules;
    userData._removed = false;
    coin.userData = userData;

    zombie.parent.add(coin);

    const allObjects = getAllObjects();
    allObjects.push(coin);
    const visibleObjects = getLoadedObjects();
    if (!visibleObjects.includes(coin)) {
        visibleObjects.push(coin);
    }

    return coin;
}

function updateDeadZombie(zombie, delta) {
    const ud = zombie.userData || (zombie.userData = {});
    const size = (ud && ud.rules && ud.rules.geometry)
        ? ud.rules.geometry
        : DEFAULT_ZOMBIE_SIZE;
    if (ud._corpseStartY === undefined) {
        ud._corpseStartY = zombie.position.y;
    }
    if (ud._corpseSinkDistance === undefined) {
        const height = (size && size[1] > 0) ? size[1] : DEFAULT_ZOMBIE_SIZE[1];
        ud._corpseSinkDistance = height * CORPSE_SINK_DISTANCE_MULTIPLIER;
    }
    ud._corpseTime = (ud._corpseTime || 0) + delta;
    if (ud._corpseTime < CORPSE_FLOAT_DELAY) {
        zombie.position.y = ud._corpseStartY;
        return false;
    }
    const activeTime = ud._corpseTime - CORPSE_FLOAT_DELAY;
    const progress = Math.min(activeTime / CORPSE_SINK_DURATION, 1);
    const sinkDistance = ud._corpseSinkDistance || 0;
    zombie.position.y = ud._corpseStartY - sinkDistance * progress;

    return progress >= 1;
}

// Update zombies: handle animation and simple wandering movement
export function updateZombies(delta, playerObj, onPlayerHit, playerState = {}) {
    const { isSneaking = false } = playerState;
    const activeDistance = getZombieActiveDistanceForFrame(delta);
    updateZombieSettingsDisplay(activeDistance);
    const visibleObjects = getLoadedObjects();
    const collidableObjects = visibleObjects.filter(o => {
        const rules = (o.userData && o.userData.rules) ? o.userData.rules : {};
        // Ignore other zombies so they don't block each other
        return rules.collidable && !zombies.includes(o);
    });

    const safeZones = getSafeZoneList();
    const playerPosition = playerObj?.position;
    const playerInSafeZone = playerPosition
        ? pointInsideAnySafeZone(playerPosition, safeZones)
        : false;
    const gunshotInSafeZone = (lastGunshot && safeZones.length)
        ? pointInsideAnySafeZone(lastGunshot.position, safeZones)
        : false;

    // Clear old gunshot data after a few seconds
    const now = performance.now() / 1000;
    if (lastGunshot && now - lastGunshot.time > 3) {
        lastGunshot = null;
    }

    const corpsesToRemove = [];

    zombies.forEach(zombie => {
        const ud = zombie.userData || (zombie.userData = {});
        if (ud.hp <= 0) {
            removeZombieFromGrid(zombie);
            if (updateDeadZombie(zombie, delta)) {
                corpsesToRemove.push(zombie);
            }
            return;
        }

        const wasInactive = !zombie.visible;
        const dist = zombie.position.distanceTo(playerObj.position);
        if (dist > activeDistance) {
            zombie.visible = false;
            removeZombieFromGrid(zombie);
            return;
        }

        zombie.visible = true;
        if (wasInactive) {
            resolveZombieOverlap(zombie, collidableObjects);
        }

        if (ud.mixer) {
            ud.mixer.update(delta);
        }

        let moving = false;

        // Apply knockback velocity if present
        if (ud.knockback) {
            const kb = ud.knockback;
            if (kb.lengthSq() > 0.0001) {
                const displacement = kb.clone().multiplyScalar(delta);
                tryMove(zombie, displacement, collidableObjects);
                kb.multiplyScalar(Math.max(0, 1 - 5 * delta));
                moving = true;
            }
        }

        // Check for nearby gunshots and trigger temporary aggro
        const baseSpotRange = ud.spotDistance || 8;
        // Sneaking halves the distance at which zombies can spot the player.
        const spotRangeMultiplier = isSneaking ? 0.5 : 1;
        const spotRange = baseSpotRange * spotRangeMultiplier;
        if (!playerInSafeZone && lastGunshot && !gunshotInSafeZone &&
            zombie.position.distanceTo(lastGunshot.position) <= spotRange) {
            // Become aggressive toward the player for 3-10 seconds
            ud._aggroTime = 3 + Math.random() * 7;
        }
        ud._aggroTime = Math.max(0, (ud._aggroTime || 0) - delta);

        // Hunt the player if within spotting distance or temporarily aggroed
        const toPlayer = new THREE.Vector3().subVectors(playerObj.position, zombie.position);
        const distToPlayer = Math.hypot(toPlayer.x, toPlayer.z);

        if (!playerInSafeZone && (distToPlayer <= spotRange || ud._aggroTime > 0)) {
            // Move directly toward the player
            const dir = toPlayer.setY(0).normalize();
            const displacement = dir.clone().multiplyScalar(ud.speed);
            if (tryMove(zombie, displacement, collidableObjects)) {
                const targetRot = Math.atan2(dir.x, dir.z);
                const currentRot = zombie.rotation.y;
                const rotDiff = THREE.MathUtils.euclideanModulo(targetRot - currentRot + Math.PI, Math.PI * 2) - Math.PI;
                const turnSpeed = ud.turnSpeed || 5;
                zombie.rotation.y = currentRot + rotDiff * Math.min(1, turnSpeed * delta);
                moving = true;
            }
            // Reset wandering so the zombie continues to chase
            ud._wanderTime = 0;
        } else {
            // Wander randomly when the player is not nearby
            ud._wanderTime = ud._wanderTime ?? 0;
            ud._wanderDir = ud._wanderDir || new THREE.Vector3();
            if (ud._wanderTime <= 0) {
                const angle = Math.random() * Math.PI * 2;
                ud._wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
                ud._wanderTime = 2 + Math.random() * 3;
            }
            const displacement = ud._wanderDir.clone().multiplyScalar(ud.speed * 0.5);
            if (tryMove(zombie, displacement, collidableObjects)) {
                // Rotate smoothly to face the direction of movement
                const targetRot = Math.atan2(
                    ud._wanderDir.x,
                    ud._wanderDir.z
                );
                const currentRot = zombie.rotation.y;
                const rotDiff = THREE.MathUtils.euclideanModulo(targetRot - currentRot + Math.PI, Math.PI * 2) - Math.PI;
                const turnSpeed = ud.turnSpeed || 5;
                zombie.rotation.y = currentRot + rotDiff * Math.min(1, turnSpeed * delta);
                moving = true;
            } else {
                ud._wanderTime = 0; // pick new direction next frame
            }
            ud._wanderTime -= delta;
        }

        // Prevent zombies from stacking by nudging them away from
        // each other when they get too close. This keeps a small
        // separation between zombies while still allowing them to
        // chase the player. Use a spatial grid to only compare nearby zombies.
        const mySize = (ud && ud.rules && ud.rules.geometry)
            ? ud.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;

        const { cx, cz } = updateZombieGridCell(zombie, wasInactive);

        if (cx !== undefined && cz !== undefined) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = zombieGrid.get(cellKey(cx + dx, cz + dz));
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
        }

        // Update cell again in case separation pushed the zombie elsewhere
        updateZombieGridCell(zombie);

        // Reduce attack cooldown timer
        ud._hitTimer = Math.max((ud._hitTimer || 0) - delta, 0);

        // Player collision
        const size = (ud && ud.rules && ud.rules.geometry)
            ? ud.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;
        const zCenter = new THREE.Vector3(zombie.position.x, zombie.position.y + size[1] / 2, zombie.position.z);
        const zBox = new THREE.Box3().setFromCenterAndSize(zCenter, new THREE.Vector3(...size));
        const pCenter = new THREE.Vector3(playerObj.position.x, 1.6, playerObj.position.z);
        const pBox = new THREE.Box3().setFromCenterAndSize(pCenter, new THREE.Vector3(0.5, 1.6, 0.5));
        if (pBox.intersectsBox(zBox) && ud._hitTimer === 0) {
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
            ud._hitTimer = ud.attackCooldown || 1;
        }

        setZombieAnimation(zombie, moving);
        ud._lastValidPos = zombie.position.clone();
    });

    if (corpsesToRemove.length) {
        const loadedObjects = getAllObjects();
        corpsesToRemove.forEach(deadZombie => {
            removeZombieFromGrid(deadZombie);
            deadZombie.parent?.remove(deadZombie);
            const idx = zombies.indexOf(deadZombie);
            if (idx !== -1) {
                zombies.splice(idx, 1);
            }
            const visibleIdx = visibleObjects.indexOf(deadZombie);
            if (visibleIdx !== -1) {
                visibleObjects.splice(visibleIdx, 1);
            }
            const loadedIdx = loadedObjects.indexOf(deadZombie);
            if (loadedIdx !== -1) {
                loadedObjects.splice(loadedIdx, 1);
            }
        });
        rebuildZombieGrid();
    }
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
        zombie.visible = true;
        zombie.userData._corpseTime = 0;
        const corpseSize = (zombie.userData && zombie.userData.rules && zombie.userData.rules.geometry)
            ? zombie.userData.rules.geometry
            : DEFAULT_ZOMBIE_SIZE;
        const corpseHeight = (corpseSize && corpseSize[1] > 0) ? corpseSize[1] : DEFAULT_ZOMBIE_SIZE[1];
        zombie.userData._corpseSinkDistance = corpseHeight * CORPSE_SINK_DISTANCE_MULTIPLIER;
        if (zombie.userData.knockback) {
            zombie.userData.knockback.set(0, 0, 0);
        }
        if (zombie.userData.mixer && typeof zombie.userData.mixer.stopAllAction === 'function') {
            zombie.userData.mixer.stopAllAction();
        }
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
        layZombieCorpseFlat(zombie);
        zombie.userData._corpseStartY = zombie.position.y;

        maybeDropCoin(zombie);

        // Lay the corpse flat at ground level before the sinking effect
        // gradually lowers it beneath the floor.

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

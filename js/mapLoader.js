import { registerDoor, resetDoors } from './doors.js';

// mapLoader.js

let loadedObjects = [];
let visibleObjects = [];
let objectRules = {};
let geometries = {};
let materials = {};
let textures = {};
let gltfModels = {};
let gltfAnimations = {};
let gltfLoadedFlags = {};
let walkablePositions = [];
let safeZones = [];
const DEFAULT_ZOMBIE_SIZE = [0.7, 1.8, 0.7];
const WALKABLE_TYPE_KEYWORDS = ['floor', 'terrain', 'ground'];
const DEFAULT_SAFE_ZONE_SETTINGS = {
    blockDoors: true,
    padding: 0.5,
    maxDistance: 24,
    minY: -Infinity,
    maxY: Infinity
};

let loadingManager = THREE.DefaultLoadingManager;
let textureLoader = new THREE.TextureLoader(loadingManager);
let gltfLoader = new THREE.GLTFLoader(loadingManager);

export function registerLoadingManager(manager) {
    loadingManager = manager || THREE.DefaultLoadingManager;
    textureLoader = new THREE.TextureLoader(loadingManager);
    gltfLoader = new THREE.GLTFLoader(loadingManager);
}

function loadGLTFModel(id, modelPath) {
    return new Promise((resolve, reject) => {
        if (gltfModels[id]) return resolve();
        gltfLoader.load(
            modelPath,
            gltf => {
                gltfModels[id] = gltf.scene;
                // Skip any default "Static" clip to prevent it from
                // overriding the real animated clip (e.g. Mixamo export).
                gltfAnimations[id] = (gltf.animations || []).filter(
                    clip => clip.name.toLowerCase() !== 'static'
                );
                gltfLoadedFlags[id] = true;
                resolve();
            },
            undefined,
            err => {
                console.warn(`Failed to load GLTF for ${id}: ${modelPath}`, err);
                gltfLoadedFlags[id] = false;
                resolve();
            }
        );
    });
}

function isWalkableType(type) {
    if (!type) return false;
    const lower = type.toLowerCase();
    return WALKABLE_TYPE_KEYWORDS.some(keyword => lower.includes(keyword));
}

function applyPosition(mesh, position, rule) {
    if (Array.isArray(position)) {
        mesh.position.fromArray(position);
    } else if (position && typeof position === 'object') {
        mesh.position.set(
            position.x ?? 0,
            position.y ?? 0,
            position.z ?? 0
        );
    } else {
        mesh.position.set(0, 0, 0);
    }

    if (!rule) return;

    const yIsHalfTile = Math.abs(mesh.position.y - 0.5) < 1e-6;

    if (yIsHalfTile && rule.geometry) {
        if (rule.ai && rule.model) {
            mesh.position.y = 0;
        } else {
            mesh.position.y = rule.geometry[1] / 2;
        }
    }

    const shouldAlignModelCenter = rule.model && rule.geometry && Number.isFinite(mesh.position.y);
    if (shouldAlignModelCenter) {
        const desiredCenterY = mesh.position.y;
        const bbox = new THREE.Box3().setFromObject(mesh);
        if (Number.isFinite(bbox.min.y) && Number.isFinite(bbox.max.y)) {
            const currentCenterY = (bbox.min.y + bbox.max.y) / 2;
            mesh.position.y += desiredCenterY - currentCenterY;
        }
    }
}

// Cache a bounding box for the object so collision tests don't
// need to reconstruct it every frame. The box is stored along with
// the transform values so we can detect when it becomes stale.
function cacheBoundingBox(obj) {
    obj.updateMatrixWorld(true);
    obj.userData._bbox = new THREE.Box3().setFromObject(obj);
    obj.userData._bboxPos = obj.position.clone();
    obj.userData._bboxQuat = obj.quaternion.clone();
    obj.userData._bboxScale = obj.scale.clone();
}

export async function loadMap(scene) {
    // GitHub Pages and other static hosts cannot execute PHP files.
    // Instead of requesting "mapmaker.php" to list available JSON files,
    // we directly reference the JSON sources used by the game.
    const jsonFiles = ['objects', 'zombies'];

    objectRules = {};
    geometries = {};
    materials = {};
    textures = {};
    gltfModels = {};
    gltfAnimations = {};
    gltfLoadedFlags = {};

    let allDefinitions = [];
    let gltfPromises = [];
    for (let file of jsonFiles) {
        if (file === 'saved_map') continue;
        const label = `map:${file}.json`;
        if (loadingManager && typeof loadingManager.itemStart === 'function') {
            loadingManager.itemStart(label);
        }
        try {
            const res = await fetch(`${file}.json`);
            if (!res.ok) continue;
            try {
                const arr = await res.json();
                allDefinitions = allDefinitions.concat(arr);
            } catch (e) {
                console.warn(`Invalid JSON in ${file}.json`, e);
            }
        } finally {
            if (loadingManager && typeof loadingManager.itemEnd === 'function') {
                loadingManager.itemEnd(label);
            }
        }
    }

    for (const obj of allDefinitions) {
        objectRules[obj.id] = {
            collidable: obj.collidable === true,
            model: obj.model || null,
            ai: obj.ai === true || obj.isZombie === true, // extra fallback
            geometry: obj.size ? obj.size.slice() : ((obj.ai === true || obj.isZombie === true) ? DEFAULT_ZOMBIE_SIZE.slice() : [1,1,1]),
            color: obj.color || '#999999',
            texture: obj.texture || null,
            safeZone: obj.safeZone !== undefined ? JSON.parse(JSON.stringify(obj.safeZone)) : false
        };
        if (!obj.model) {
            if (!geometries[obj.id] && obj.size) {
                geometries[obj.id] = new THREE.BoxGeometry(...obj.size);
            }
            if (!materials[obj.id]) {
                if (obj.texture) {
                    if (!textures[obj.texture]) {
                        textures[obj.texture] = textureLoader.load(obj.texture);
                    }
                    materials[obj.id] = new THREE.MeshLambertMaterial({
                        map: textures[obj.texture],
                        color: obj.color || '#999999'
                    });
                } else {
                    materials[obj.id] = new THREE.MeshLambertMaterial({
                        color: obj.color || '#999999',
                        opacity: 1,
                        transparent: false
                    });
                }
            }
        } else if (obj.model) {
            gltfLoadedFlags[obj.id] = false;
            gltfPromises.push(loadGLTFModel(obj.id, obj.model));
        }
    }

    await Promise.all(gltfPromises);

    // The map data is stored in a static JSON file when served from GitHub Pages.
    const mapLabel = 'map:saved_map.json';
    if (loadingManager && typeof loadingManager.itemStart === 'function') {
        loadingManager.itemStart(mapLabel);
    }
    let resMap;
    try {
        resMap = await fetch('saved_map.json');
    } catch (error) {
        console.error('Failed to fetch map data.', error);
        if (loadingManager && typeof loadingManager.itemEnd === 'function') {
            loadingManager.itemEnd(mapLabel);
        }
        return [];
    }
    if (loadingManager && typeof loadingManager.itemEnd === 'function') {
        loadingManager.itemEnd(mapLabel);
    }
    if (!resMap.ok) {
        console.error('Failed to fetch map data.');
        return [];
    }
    let mapData;
    try {
        mapData = await resMap.json();
    } catch (e) {
        console.error('Invalid JSON from saved_map.json', e);
        return [];
    }

    loadedObjects = [];
    walkablePositions = [];
    safeZones = [];
    resetDoors();
    const walkableSet = new Set();

    for (const item of mapData) {
        const { position, type, rotation = 0 } = item;
        if (type === 'hill') continue;
        const rule = objectRules[type];
        const walkablePos = Array.isArray(position)
            ? new THREE.Vector3(position[0] || 0, position[1] || 0, position[2] || 0)
            : (position && typeof position === 'object' && 'x' in position && 'z' in position
                ? new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0)
                : null);
        const qualifiesWalkable = (rule && rule.collidable === false) || isWalkableType(type);
        let mesh = null;

        // ---- NEW: Always allow zombies and model objects! ----
        if (rule && rule.model && gltfModels[type]) {
            mesh = gltfModels[type].clone(true);
            mesh.traverse(node => {
                if (node.isMesh) {
                    node.material = node.material.clone();
                    node.material.opacity = 1;
                    node.material.transparent = false;
                }
            });
            if (rule.geometry) {
                const box = new THREE.Box3().setFromObject(mesh);
                const size = new THREE.Vector3();
                box.getSize(size);
                if (size.x > 0 && size.y > 0 && size.z > 0) {
                    mesh.scale.set(
                        rule.geometry[0] / size.x,
                        rule.geometry[1] / size.y,
                        rule.geometry[2] / size.z
                    );
                }
            }
            if (gltfAnimations[type] && gltfAnimations[type].length > 0) {
                const mixer = new THREE.AnimationMixer(mesh);
                gltfAnimations[type].forEach(clip => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });
                mesh.userData.mixer = mixer;
            }
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            if (rule.ai) mesh.userData.ai = true;
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else if (rule && (rule.ai || item.ai || item.isZombie)) {
            // If missing model, fallback to box for zombie
            let geo = geometries[type] || new THREE.BoxGeometry(...(rule.geometry || [1,1,1]));
            let mat = materials[type] || new THREE.MeshLambertMaterial({ color: rule.color || 0x44ff44 });
            mesh = new THREE.Mesh(geo, mat);
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule, ai: true };
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else if (rule && geometries[type] && materials[type]) {
            mesh = new THREE.Mesh(geometries[type], materials[type]);
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else if (rule && rule.geometry) {
            // Final fallback for unknown object with geometry (render as colored box)
            const geo = new THREE.BoxGeometry(...rule.geometry);
            let mat;
            if (rule.texture) {
                if (!textures[rule.texture]) {
                    textures[rule.texture] = textureLoader.load(rule.texture);
                }
                mat = new THREE.MeshLambertMaterial({
                    map: textures[rule.texture],
                    color: rule.color
                });
            } else {
                mat = new THREE.MeshLambertMaterial({ color: rule.color, opacity: 1 });
            }
            mesh = new THREE.Mesh(geo, mat);
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else {
            console.warn(`Unknown object type: ${type}`, item);
        }

        if (walkablePos && qualifiesWalkable) {
            const sourcePos = mesh ? mesh.position : walkablePos;
            const height = (rule && Array.isArray(rule.geometry) && rule.geometry.length >= 2)
                ? rule.geometry[1] / 2
                : 0.5;
            const spawnPos = new THREE.Vector3(
                sourcePos.x,
                (sourcePos.y !== undefined ? sourcePos.y : 0) - height,
                sourcePos.z
            );
            const key = `${spawnPos.x}|${spawnPos.y}|${spawnPos.z}`;
            if (!walkableSet.has(key)) {
                walkableSet.add(key);
                walkablePositions.push(spawnPos);
            }
        }
    }

    computeSafeZones();
    updateVisibleObjects(scene, 0, 0, 40);
    scene.fog = new THREE.Fog(0x000000, 2, 15);
    return loadedObjects;
}

function tileKey(x, z) {
    return `${x}|${z}`;
}

function normalizeSafeZoneConfig(config) {
    if (!config) return null;
    if (config === true) {
        return { ...DEFAULT_SAFE_ZONE_SETTINGS };
    }
    if (typeof config === 'object') {
        return {
            blockDoors: config.blockDoors !== false,
            padding: typeof config.padding === 'number' ? config.padding : DEFAULT_SAFE_ZONE_SETTINGS.padding,
            maxDistance: typeof config.maxDistance === 'number' ? config.maxDistance : DEFAULT_SAFE_ZONE_SETTINGS.maxDistance,
            minY: typeof config.minY === 'number' ? config.minY : DEFAULT_SAFE_ZONE_SETTINGS.minY,
            maxY: typeof config.maxY === 'number' ? config.maxY : DEFAULT_SAFE_ZONE_SETTINGS.maxY
        };
    }
    return null;
}

function buildSafeZoneFromOrigin(origin, config, collidableTiles, doorTiles) {
    if (!origin || !origin.position) return null;

    const startX = Math.round(origin.position.x);
    const startZ = Math.round(origin.position.z);
    const queue = [{ x: startX, z: startZ }];
    const visited = new Set();

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    const maxDistance = Math.max(1, config.maxDistance ?? DEFAULT_SAFE_ZONE_SETTINGS.maxDistance);

    for (let i = 0; i < queue.length; i++) {
        const { x, z } = queue[i];
        const key = tileKey(x, z);
        if (visited.has(key)) continue;
        visited.add(key);

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        const neighbors = [
            { x: x + 1, z },
            { x: x - 1, z },
            { x, z: z + 1 },
            { x, z: z - 1 }
        ];

        for (const neighbor of neighbors) {
            const nk = tileKey(neighbor.x, neighbor.z);
            if (visited.has(nk)) continue;
            if (Math.abs(neighbor.x - startX) > maxDistance || Math.abs(neighbor.z - startZ) > maxDistance) continue;
            if (collidableTiles.has(nk)) continue;
            if (config.blockDoors && doorTiles.has(nk)) continue;
            queue.push(neighbor);
        }
    }

    if (!visited.size) return null;

    const padding = Math.max(0, Number.isFinite(config.padding) ? config.padding : DEFAULT_SAFE_ZONE_SETTINGS.padding);
    const zoneMinX = minX - padding;
    const zoneMaxX = maxX + padding;
    const zoneMinZ = minZ - padding;
    const zoneMaxZ = maxZ + padding;

    if (!(zoneMinX < zoneMaxX) || !(zoneMinZ < zoneMaxZ)) {
        return null;
    }

    const minY = Number.isFinite(config.minY) ? config.minY : DEFAULT_SAFE_ZONE_SETTINGS.minY;
    const maxY = Number.isFinite(config.maxY) ? config.maxY : DEFAULT_SAFE_ZONE_SETTINGS.maxY;

    return {
        minX: zoneMinX,
        maxX: zoneMaxX,
        minZ: zoneMinZ,
        maxZ: zoneMaxZ,
        minY,
        maxY,
        origin: origin.position.clone ? origin.position.clone() : { ...origin.position },
        sourceType: origin.userData?.type || null
    };
}

function computeSafeZones() {
    safeZones = [];
    if (!Array.isArray(loadedObjects) || loadedObjects.length === 0) {
        return;
    }

    const collidableTiles = new Set();
    const doorTiles = new Set();
    const origins = [];

    for (const obj of loadedObjects) {
        if (!obj || !obj.userData) continue;
        const rule = obj.userData.rules || {};
        const pos = obj.position || { x: 0, z: 0, y: 0 };
        const key = tileKey(Math.round(pos.x || 0), Math.round(pos.z || 0));

        if (rule.collidable) {
            collidableTiles.add(key);
        }
        if (obj.userData.type === 'door') {
            doorTiles.add(key);
        }

        const safeZoneConfig = normalizeSafeZoneConfig(rule.safeZone);
        if (safeZoneConfig) {
            origins.push({ object: obj, config: safeZoneConfig });
        }
    }

    origins.forEach(({ object, config }) => {
        const zone = buildSafeZoneFromOrigin(object, config, collidableTiles, doorTiles);
        if (zone) {
            safeZones.push(zone);
        }
    });
}

export function getLoadedObjects() {
    visibleObjects = visibleObjects.filter(obj => obj && !(obj.userData && obj.userData._removed));
    return visibleObjects;
}

export function getAllObjects() {
    loadedObjects = loadedObjects.filter(obj => obj && !(obj.userData && obj.userData._removed));
    return loadedObjects;
}

export function getSafeZones() {
    return safeZones;
}

export function getWalkablePositions() {
    return walkablePositions.map(pos => pos.clone());
}

export function updateVisibleObjects(scene, playerX, playerZ, viewDist) {
    visibleObjects.forEach(obj => scene.remove(obj));
    visibleObjects = [];
    loadedObjects.forEach(obj => {
        if (!obj || (obj.userData && obj.userData._removed)) {
            if (obj && obj.parent === scene) {
                scene.remove(obj);
            }
            return;
        }
        const dx = obj.position.x - playerX;
        const dz = obj.position.z - playerZ;
        if ((dx * dx + dz * dz) < viewDist * viewDist) {
            scene.add(obj);
            visibleObjects.push(obj);
        }
    });
}

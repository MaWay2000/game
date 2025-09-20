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
let currentMapPath = 'maps/home.json';
let objectMixers = new Set();
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

const DEFAULT_LABEL_CONFIG = {
    color: '#ffffff',
    background: 'rgba(0, 0, 0, 0.65)',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: 96,
    padding: 32,
    stroke: 'rgba(0, 0, 0, 0.85)',
    strokeWidth: 12,
    offset: 0.4,
    height: 0.6,
    width: null,
    maxWidth: null
};

function roundForKey(value) {
    const numeric = Number(value) || 0;
    return Math.round(numeric * 1000) / 1000;
}

function createSaveKey(item, index) {
    const type = typeof item?.type === 'string' ? item.type : 'unknown';
    const rotation = Number.isFinite(item?.rotation) ? item.rotation : 0;
    let px = 0, py = 0, pz = 0;
    const position = item?.position;
    if (Array.isArray(position)) {
        px = Number(position[0]) || 0;
        py = Number(position[1]) || 0;
        pz = Number(position[2]) || 0;
    } else if (position && typeof position === 'object') {
        px = Number(position.x ?? position[0]) || 0;
        py = Number(position.y ?? position[1]) || 0;
        pz = Number(position.z ?? position[2]) || 0;
    }
    const idx = Number.isFinite(index) ? index : 0;
    return `${type}|${idx}|${roundForKey(px)}|${roundForKey(py)}|${roundForKey(pz)}|${roundForKey(rotation)}`;
}

function buildUserData(item, rule, index) {
    const data = { ...item, rules: rule };
    if (Number.isInteger(index)) {
        data.mapIndex = index;
    }
    data.saveKey = createSaveKey(item, index);
    return data;
}

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

    if (rule.id === 'door' && rule.geometry && rule.geometry.length >= 2) {
        const halfHeight = rule.geometry[1] / 2;
        if (Number.isFinite(halfHeight) && Number.isFinite(mesh.position.y)) {
            const offset = mesh.position.y - halfHeight;
            if (offset < -1e-6 && Math.abs(offset + 0.5) < 1e-4) {
                mesh.position.y = halfHeight;
            }
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

function normalizeLabelConfig(label, fallbackText) {
    if (label === undefined || label === null || label === false) {
        return null;
    }

    if (label === true) {
        const text = typeof fallbackText === 'string' ? fallbackText.trim() : '';
        return text ? { ...DEFAULT_LABEL_CONFIG, text } : null;
    }

    if (typeof label === 'string') {
        const text = label.trim();
        return text ? { ...DEFAULT_LABEL_CONFIG, text } : null;
    }

    if (typeof label === 'object') {
        const textSource = label.text !== undefined ? label.text : fallbackText;
        const text = typeof textSource === 'string' ? textSource.trim() : '';
        if (!text) {
            return null;
        }

        return {
            text,
            color: typeof label.color === 'string' ? label.color : DEFAULT_LABEL_CONFIG.color,
            background: label.background === null ? null : (typeof label.background === 'string' ? label.background : DEFAULT_LABEL_CONFIG.background),
            fontFamily: typeof label.fontFamily === 'string' ? label.fontFamily : DEFAULT_LABEL_CONFIG.fontFamily,
            fontSize: Number.isFinite(label.fontSize) ? label.fontSize : DEFAULT_LABEL_CONFIG.fontSize,
            padding: Number.isFinite(label.padding) ? Math.max(0, label.padding) : DEFAULT_LABEL_CONFIG.padding,
            stroke: typeof label.stroke === 'string' ? label.stroke : DEFAULT_LABEL_CONFIG.stroke,
            strokeWidth: Number.isFinite(label.strokeWidth) ? Math.max(0, label.strokeWidth) : DEFAULT_LABEL_CONFIG.strokeWidth,
            offset: Number.isFinite(label.offset) ? label.offset : DEFAULT_LABEL_CONFIG.offset,
            height: Number.isFinite(label.height) ? label.height : DEFAULT_LABEL_CONFIG.height,
            width: Number.isFinite(label.width) ? label.width : DEFAULT_LABEL_CONFIG.width,
            maxWidth: Number.isFinite(label.maxWidth) ? label.maxWidth : DEFAULT_LABEL_CONFIG.maxWidth
        };
    }

    return null;
}

function createLabelSprite(text, config = {}) {
    if (typeof document === 'undefined') {
        return null;
    }

    const canvas = document.createElement('canvas');
    const canvasWidth = 512;
    const canvasHeight = 256;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const padding = Math.max(0, Number.isFinite(config.padding) ? config.padding : DEFAULT_LABEL_CONFIG.padding);
    const fontFamily = config.fontFamily || DEFAULT_LABEL_CONFIG.fontFamily;
    let fontSize = Number.isFinite(config.fontSize) ? config.fontSize : DEFAULT_LABEL_CONFIG.fontSize;
    const minFontSize = 12;
    const availableWidth = Math.max(32, (Number.isFinite(config.maxWidth) ? config.maxWidth : (canvasWidth - padding * 2)));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let measuredWidth = Infinity;
    while (fontSize > minFontSize) {
        ctx.font = `${fontSize}px ${fontFamily}`;
        measuredWidth = ctx.measureText(text).width;
        if (measuredWidth <= availableWidth) {
            break;
        }
        fontSize -= 2;
    }
    ctx.font = `${Math.max(fontSize, minFontSize)}px ${fontFamily}`;
    measuredWidth = ctx.measureText(text).width;

    const textHeight = fontSize;
    const bgWidth = Math.min(canvasWidth, measuredWidth + padding * 2);
    const bgHeight = Math.min(canvasHeight, textHeight + padding * 2);
    const bgX = (canvasWidth - bgWidth) / 2;
    const bgY = (canvasHeight - bgHeight) / 2;

    if (config.background) {
        ctx.fillStyle = config.background;
        ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
    }

    if (config.stroke && config.strokeWidth > 0) {
        ctx.lineWidth = config.strokeWidth;
        ctx.strokeStyle = config.stroke;
        ctx.strokeText(text, canvasWidth / 2, canvasHeight / 2, availableWidth);
    }

    ctx.fillStyle = config.color || DEFAULT_LABEL_CONFIG.color;
    ctx.fillText(text, canvasWidth / 2, canvasHeight / 2, availableWidth);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    const baseHeight = Number.isFinite(config.height) ? config.height : DEFAULT_LABEL_CONFIG.height;
    const baseWidth = Number.isFinite(config.width) && config.width > 0
        ? config.width
        : baseHeight * (bgWidth / bgHeight);
    sprite.scale.set(baseWidth, baseHeight, 1);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 1000;
    sprite.userData = { ...sprite.userData, isLabel: true, labelText: text };

    return sprite;
}

function attachLabelToMesh(mesh, labelConfig) {
    if (!mesh || !labelConfig || !labelConfig.text) {
        return;
    }

    const sprite = createLabelSprite(labelConfig.text, labelConfig);
    if (!sprite) {
        return;
    }

    mesh.updateWorldMatrix(true, false);
    const bbox = new THREE.Box3().setFromObject(mesh);
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);

    const offset = Number.isFinite(labelConfig.offset) ? labelConfig.offset : DEFAULT_LABEL_CONFIG.offset;
    const topY = Number.isFinite(bbox.max.y) ? bbox.max.y : (worldPos.y + offset);
    sprite.position.set(0, (topY - worldPos.y) + offset, 0);

    mesh.add(sprite);
}

export async function loadMap(scene, mapPath = 'maps/home.json') {
    const targetMapPath = (typeof mapPath === 'string' && mapPath.trim())
        ? mapPath.trim()
        : 'maps/home.json';

    if (scene) {
        loadedObjects.forEach(obj => {
            if (obj && obj.parent === scene) {
                scene.remove(obj);
            }
        });
        visibleObjects.forEach(obj => {
            if (obj && obj.parent === scene) {
                scene.remove(obj);
            }
        });
    }

    objectMixers.forEach(entry => {
        if (entry && entry.mixer && typeof entry.mixer.stopAllAction === 'function') {
            entry.mixer.stopAllAction();
        }
    });
    objectMixers = new Set();

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
        const labelConfig = normalizeLabelConfig(
            obj.label !== undefined ? obj.label : obj.labelText,
            obj.name || obj.id
        );

        objectRules[obj.id] = {
            id: obj.id,
            name: obj.name || obj.id,
            collidable: obj.collidable === true,
            model: obj.model || null,
            ai: obj.ai === true || obj.isZombie === true, // extra fallback
            geometry: obj.size ? obj.size.slice() : ((obj.ai === true || obj.isZombie === true) ? DEFAULT_ZOMBIE_SIZE.slice() : [1,1,1]),
            color: obj.color || '#999999',
            texture: obj.texture || null,
            safeZone: obj.safeZone !== undefined ? JSON.parse(JSON.stringify(obj.safeZone)) : false,
            label: labelConfig
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
    const mapLabel = `map:${targetMapPath}`;
    if (loadingManager && typeof loadingManager.itemStart === 'function') {
        loadingManager.itemStart(mapLabel);
    }
    let resMap;
    try {
        resMap = await fetch(targetMapPath);
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
        console.error(`Failed to fetch map data from ${targetMapPath}.`);
        return [];
    }
    let mapData;
    try {
        mapData = await resMap.json();
    } catch (e) {
        console.error(`Invalid JSON from ${targetMapPath}`, e);
        return [];
    }

    currentMapPath = targetMapPath;
    loadedObjects = [];
    visibleObjects = [];
    walkablePositions = [];
    safeZones = [];
    resetDoors();
    const walkableSet = new Set();

    for (let index = 0; index < mapData.length; index++) {
        const item = mapData[index];
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
            let overrideColor = null;
            if (rule.color) {
                try {
                    overrideColor = new THREE.Color(rule.color);
                } catch (err) {
                    console.warn(`Failed to parse color "${rule.color}" for ${type}:`, err);
                }
            }
            mesh.traverse(node => {
                if (node.isMesh) {
                    node.material = node.material.clone();
                    node.material.opacity = 1;
                    node.material.transparent = false;

                    if (overrideColor && node.material && node.material.color && !node.material.map) {
                        const color = node.material.color;
                        const colorMagnitude = color.r * color.r + color.g * color.g + color.b * color.b;
                        const hasVertexColors = Boolean(node.geometry && node.geometry.getAttribute && node.geometry.getAttribute('color'));
                        if (!hasVertexColors && colorMagnitude < 1e-4) {
                            color.copy(overrideColor);
                            if (typeof node.material.needsUpdate !== 'undefined') {
                                node.material.needsUpdate = true;
                            }
                        }
                    }
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
            let mixer = null;
            if (gltfAnimations[type] && gltfAnimations[type].length > 0) {
                mixer = new THREE.AnimationMixer(mesh);
                gltfAnimations[type].forEach(clip => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });
            }
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = buildUserData(item, rule, index);
            if (mixer) {
                const mixerEntry = { mixer, object: mesh };
                mesh.userData.mixer = mixer;
                mesh.userData.mixerEntry = mixerEntry;
                objectMixers.add(mixerEntry);
            }
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
            mesh.userData = buildUserData(item, rule, index);
            mesh.userData.ai = true;
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else if (rule && geometries[type] && materials[type]) {
            mesh = new THREE.Mesh(geometries[type], materials[type]);
            applyPosition(mesh, position, rule);
            mesh.rotation.y = rotation;
            mesh.userData = buildUserData(item, rule, index);
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
            mesh.userData = buildUserData(item, rule, index);
            loadedObjects.push(mesh);
            if (type === 'door') {
                registerDoor(mesh);
            }
            if (rule.collidable) cacheBoundingBox(mesh);
        } else {
            console.warn(`Unknown object type: ${type}`, item);
        }

        if (mesh && rule) {
            let labelConfig = rule.label;
            if (item && (item.label !== undefined || item.labelText !== undefined)) {
                labelConfig = normalizeLabelConfig(
                    item.label !== undefined ? item.label : item.labelText,
                    rule.name || item.type || 'object'
                ) || labelConfig;
            }

            if (labelConfig) {
                attachLabelToMesh(mesh, labelConfig);
            }
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

export function updateObjectMixers(delta) {
    if (!objectMixers || objectMixers.size === 0) {
        return;
    }
    const timeStep = Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (timeStep <= 0) {
        return;
    }
    const staleEntries = [];
    for (const entry of objectMixers) {
        if (!entry || !entry.mixer) {
            staleEntries.push(entry);
            continue;
        }
        if (entry.object && entry.object.userData && entry.object.userData._removed) {
            if (typeof entry.mixer.stopAllAction === 'function') {
                entry.mixer.stopAllAction();
            }
            staleEntries.push(entry);
            continue;
        }
        entry.mixer.update(timeStep);
    }
    staleEntries.forEach(entry => objectMixers.delete(entry));
}

export function getAllObjects() {
    loadedObjects = loadedObjects.filter(obj => obj && !(obj.userData && obj.userData._removed));
    return loadedObjects;
}

export function getSafeZones() {
    return safeZones;
}

export function isPointInsideSafeZone(point) {
    if (!point || !Array.isArray(safeZones) || safeZones.length === 0) {
        return false;
    }

    const x = Number.isFinite(point.x) ? point.x : (Array.isArray(point) ? Number(point[0]) : 0);
    const y = Number.isFinite(point.y) ? point.y : (Array.isArray(point) ? Number(point[1]) : 0);
    const z = Number.isFinite(point.z) ? point.z : (Array.isArray(point) ? Number(point[2]) : 0);

    for (let i = 0; i < safeZones.length; i++) {
        const zone = safeZones[i];
        if (!zone) continue;
        if (x < zone.minX || x > zone.maxX) continue;
        if (z < zone.minZ || z > zone.maxZ) continue;
        const minY = Number.isFinite(zone.minY) ? zone.minY : -Infinity;
        const maxY = Number.isFinite(zone.maxY) ? zone.maxY : Infinity;
        if (y < minY || y > maxY) continue;
        return true;
    }

    return false;
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

function removeFromArray(array, value) {
    if (!Array.isArray(array)) {
        return;
    }
    const index = array.indexOf(value);
    if (index !== -1) {
        array.splice(index, 1);
    }
}

export function getObjectSaveKey(obj) {
    return obj?.userData?.saveKey || null;
}

export function markObjectRemoved(obj) {
    if (!obj) {
        return false;
    }
    if (obj.userData && typeof obj.userData === 'object') {
        const mixerEntry = obj.userData.mixerEntry;
        if (mixerEntry && objectMixers.has(mixerEntry)) {
            if (mixerEntry.mixer && typeof mixerEntry.mixer.stopAllAction === 'function') {
                mixerEntry.mixer.stopAllAction();
            }
            objectMixers.delete(mixerEntry);
        }
    }
    if (!obj.userData || typeof obj.userData !== 'object') {
        obj.userData = { _removed: true };
    } else {
        obj.userData._removed = true;
    }
    if (obj.userData?.door) {
        obj.userData.door.destroyed = true;
        obj.userData.door.sinking = false;
    }
    if (obj.parent && typeof obj.parent.remove === 'function') {
        obj.parent.remove(obj);
    }
    obj.visible = false;
    removeFromArray(visibleObjects, obj);
    removeFromArray(loadedObjects, obj);
    return true;
}

export function removeObjectBySaveKey(scene, saveKey) {
    if (typeof saveKey !== 'string' || !saveKey) {
        return false;
    }
    let removed = false;
    for (let i = loadedObjects.length - 1; i >= 0; i--) {
        const obj = loadedObjects[i];
        if (!obj || obj.userData?.saveKey !== saveKey) {
            continue;
        }
        if (scene && obj.parent === scene) {
            scene.remove(obj);
        }
        markObjectRemoved(obj);
        removed = true;
    }
    return removed;
}

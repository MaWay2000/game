let canvas, ctx;
let mapNameLabel;
let fullCanvas, fullCtx;
let fullVisible = false;
let fullMapData = null;
let minimapData = null;
let minimapDataPath = null;
let minimapDataPromise = null;
let minimapObjects = [];
let minimapObjectGrid = new Map();
let mapSource = 'maps/home.json';
let minimapEnabled = true;
let latestPlayer = null;
let latestCamera = null;
const SIZE = 150; // minimap size in pixels
const SCALE = 4; // pixels per world unit
const MINIMAP_GRID_SIZE = 10;
// Track explored cells so the full map only reveals visited areas
const exploredCells = new Set();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const rayHelper = new THREE.Ray();
const rayIntersection = new THREE.Vector3();
const playerHeightFallback = 1.6;
const removedObjectKeys = new Set();

function fetchFreshMapJson(path) {
    const requestPath = path + (path.includes('?') ? '&' : '?') + 'v=' + Date.now();
    return fetch(requestPath, { cache: 'no-store' }).then(res => res.json());
}

function roundForKey(value) {
    const numeric = Number(value) || 0;
    return Math.round(numeric * 1000) / 1000;
}

function parsePosition(position) {
    let px = 0;
    let py = 0;
    let pz = 0;
    if (Array.isArray(position)) {
        px = Number(position[0]) || 0;
        py = Number(position[1]) || 0;
        pz = Number(position[2]) || 0;
    } else if (position && typeof position === 'object') {
        px = Number(position.x ?? position[0]) || 0;
        py = Number(position.y ?? position[1]) || 0;
        pz = Number(position.z ?? position[2]) || 0;
    }
    return { x: px, y: py, z: pz };
}

function createSaveKeyForMapItem(item, index) {
    const type = typeof item?.type === 'string' ? item.type : 'unknown';
    const rotation = Number.isFinite(item?.rotation) ? item.rotation : 0;
    const { x, y, z } = parsePosition(item?.position);
    const idx = Number.isFinite(index) ? index : 0;
    return `${type}|${idx}|${roundForKey(x)}|${roundForKey(y)}|${roundForKey(z)}|${roundForKey(rotation)}`;
}

export function recordRemovedObjectKey(saveKey) {
    if (typeof saveKey !== 'string' || !saveKey) {
        return;
    }
    removedObjectKeys.add(saveKey);
}

export function syncRemovedObjectKeys(keys) {
    removedObjectKeys.clear();
    if (!keys || typeof keys[Symbol.iterator] !== 'function') {
        return;
    }
    for (const key of keys) {
        if (typeof key === 'string' && key) {
            removedObjectKeys.add(key);
        }
    }
}

export function initMinimap() {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.position = 'absolute';
    canvas.style.top = '10px';
    canvas.style.right = '10px';
    canvas.style.border = '2px solid white';
    canvas.style.background = 'rgba(0,0,0,0.4)';
    canvas.style.zIndex = '100';
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', (event) => {
        event.stopPropagation();
        if (latestPlayer && latestCamera) {
            toggleFullMap(latestPlayer, latestCamera);
        }
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    mapNameLabel = document.createElement('div');
    mapNameLabel.id = 'minimap-map-name';
    mapNameLabel.style.position = 'absolute';
    mapNameLabel.style.top = `${SIZE + 18}px`;
    mapNameLabel.style.right = '10px';
    mapNameLabel.style.width = `${SIZE}px`;
    mapNameLabel.style.padding = '5px 2px';
    mapNameLabel.style.boxSizing = 'border-box';
    mapNameLabel.style.border = '1px solid rgba(120,220,255,0.9)';
    mapNameLabel.style.background = 'rgba(0,0,0,0.75)';
    mapNameLabel.style.color = '#ffffff';
    mapNameLabel.style.font = 'bold 13px Arial, sans-serif';
    mapNameLabel.style.letterSpacing = '0.5px';
    mapNameLabel.style.textAlign = 'center';
    mapNameLabel.style.textTransform = 'uppercase';
    mapNameLabel.style.textShadow = '0 0 6px rgba(91,214,255,0.85)';
    mapNameLabel.style.zIndex = '100';
    mapNameLabel.style.pointerEvents = 'none';
    document.body.appendChild(mapNameLabel);
    updateMapNameLabel();
    loadMinimapData();
    drawPlayerMarker(SIZE / 2, SIZE / 2);
}

export function updateMinimap(player, camera, objects) {
    if (!ctx || !minimapEnabled) return;
    latestPlayer = player;
    latestCamera = camera;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const half = SIZE / 2;
    const range = half / SCALE; // world units that fit in minimap radius
    const liveObjects = Array.isArray(objects) ? objects : [];
    if ((minimapData === null || minimapDataPath !== mapSource) && !minimapDataPromise) {
        loadMinimapData();
    }
    const mapObjects = minimapObjects.length ? getMinimapDataObjects(player, range) : liveObjects;
    // Mark nearby cells as explored based on line of sight
    markExplored(player, range, mapObjects);

    ctx.fillStyle = '#f2f2f2';
    for (const obj of mapObjects) {
        if (!obj || !obj.position || !obj.userData || obj.userData.type !== 'terrain') continue;
        if (!isExplored(obj.position.x, obj.position.z)) continue;
        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
        const x = half + dx * SCALE;
        const y = half + dz * SCALE;
        ctx.fillRect(x - SCALE / 2, y - SCALE / 2, SCALE, SCALE);
    }

    ctx.fillStyle = '#888';
    for (const obj of mapObjects) {
        if (!obj || !obj.position || !obj.userData || obj.userData.type !== 'wall') continue;
        if (!isExplored(obj.position.x, obj.position.z)) continue;
        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
        const x = half + dx * SCALE;
        const y = half + dz * SCALE;
        const geo = obj.userData.rules && obj.userData.rules.geometry;
        const w = (geo ? geo[0] : 1) * SCALE;
        const h = (geo ? geo[2] : 1) * SCALE;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }

    for (const obj of mapObjects) {
        if (!obj || !obj.position || !obj.userData) continue;
        if (obj.userData.type === 'wall') continue;
        if (obj.userData.type === 'terrain') continue;
        if (obj.userData._removed) continue;
        const saveKey = typeof obj.userData.saveKey === 'string' ? obj.userData.saveKey : null;
        if (saveKey && removedObjectKeys.has(saveKey)) continue;
        if (!isExplored(obj.position.x, obj.position.z)) continue;
        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
        const x = half + dx * SCALE;
        const y = half + dz * SCALE;
        const type = obj.userData.type;
        const isDoor = type === 'door' || obj.userData.door;
        ctx.fillStyle = isDoor ? '#00f' : 'white';
        ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    // Draw player in center
    drawPlayerMarker(half, half);

    // Draw facing direction
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    ctx.strokeStyle = 'red';
    ctx.beginPath();
    ctx.moveTo(half, half);
    ctx.lineTo(half + dir.x * 10, half + dir.z * 10);
    ctx.stroke();

    if (fullVisible && fullMapData) {
        drawFullMap(player, camera, fullMapData);
    }
}

function drawPlayerMarker(x, y) {
    if (!ctx) return;
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
}

async function loadMinimapData() {
    if (minimapDataPromise) {
        return minimapDataPromise;
    }

    const requestedPath = mapSource;
    minimapDataPromise = fetchFreshMapJson(requestedPath)
        .then(data => {
            if (requestedPath !== mapSource) {
                return minimapData;
            }
            minimapData = data;
            minimapDataPath = requestedPath;
            rebuildMinimapCache();
            return minimapData;
        })
        .catch(e => {
            if (requestedPath !== mapSource) {
                return minimapData;
            }
            console.warn('Failed to load minimap data', e);
            minimapData = [];
            minimapDataPath = requestedPath;
            minimapObjects = [];
            minimapObjectGrid.clear();
            return minimapData;
        })
        .finally(() => {
            minimapDataPromise = null;
        });

    return minimapDataPromise;
}

function rebuildMinimapCache() {
    if (!Array.isArray(minimapData)) {
        minimapObjects = [];
        minimapObjectGrid.clear();
        return;
    }

    minimapObjects = minimapData.map((item, index) => {
        const position = parsePosition(item && item.position);
        const obj = {
            position: new THREE.Vector3(position.x, position.y, position.z),
            userData: {
                type: item && item.type,
                saveKey: createSaveKeyForMapItem(item, index),
                rules: {
                    geometry: item && item.type === 'wall' ? [1, 3, 1] : [1, 1, 1],
                    collidable: item && item.type === 'wall'
                }
            }
        };
        return obj;
    });
    minimapObjectGrid = new Map();
    for (const obj of minimapObjects) {
        const gx = Math.floor(obj.position.x / MINIMAP_GRID_SIZE);
        const gz = Math.floor(obj.position.z / MINIMAP_GRID_SIZE);
        const key = `${gx},${gz}`;
        let bucket = minimapObjectGrid.get(key);
        if (!bucket) {
            bucket = [];
            minimapObjectGrid.set(key, bucket);
        }
        bucket.push(obj);
    }
}

function getMinimapDataObjects(player, range) {
    if (!minimapObjects.length) {
        return [];
    }
    if (!player || !player.position || !minimapObjectGrid.size) {
        return minimapObjects;
    }

    const gridRange = Math.ceil(range / MINIMAP_GRID_SIZE);
    const centerX = Math.floor(player.position.x / MINIMAP_GRID_SIZE);
    const centerZ = Math.floor(player.position.z / MINIMAP_GRID_SIZE);
    const nearby = [];
    for (let gx = centerX - gridRange; gx <= centerX + gridRange; gx++) {
        for (let gz = centerZ - gridRange; gz <= centerZ + gridRange; gz++) {
            const bucket = minimapObjectGrid.get(`${gx},${gz}`);
            if (bucket) {
                nearby.push(...bucket);
            }
        }
    }
    return nearby;
}

function updateMapNameLabel() {
    if (!mapNameLabel) {
        return;
    }

    mapNameLabel.textContent = getMapDisplayName(mapSource);
}

function getMapDisplayName(path) {
    const fileName = String(path || '')
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '');
    const normalized = fileName.replace(/[-_]+/g, ' ').trim();
    if (!normalized) {
        return 'Unknown Map';
    }

    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function toggleFullMap(player, camera) {
    if (!minimapEnabled) {
        return;
    }

    if (!fullCanvas) {
        fullCanvas = document.createElement('canvas');
        fullCanvas.width = 600;
        fullCanvas.height = 600;
        fullCanvas.style.position = 'absolute';
        fullCanvas.style.left = '50%';
        fullCanvas.style.top = '50%';
        fullCanvas.style.transform = 'translate(-50%, -50%)';
        fullCanvas.style.border = '2px solid white';
        fullCanvas.style.background = 'rgba(0,0,0,0.8)';
        fullCanvas.style.zIndex = '1000';
        fullCanvas.style.display = 'none';
        document.body.appendChild(fullCanvas);
        fullCtx = fullCanvas.getContext('2d');
    }
    fullVisible = !fullVisible;
    fullCanvas.style.display = fullVisible ? 'block' : 'none';
    if (fullVisible) {
        if (!fullMapData) {
            try {
                fullMapData = await fetchFreshMapJson(mapSource);
            } catch (e) {
                console.error('Failed to load full map data', e);
                fullMapData = [];
            }
        }
        drawFullMap(player, camera, fullMapData);
    }
}

export function isFullMapVisible() {
    return fullVisible;
}

export function setMinimapMapSource(path) {
    if (typeof path !== 'string') {
        return;
    }
    const trimmed = path.trim();
    if (!trimmed || mapSource === trimmed) {
        return;
    }
    mapSource = trimmed;
    fullMapData = null;
    minimapData = null;
    minimapDataPath = null;
    minimapDataPromise = null;
    minimapObjects = [];
    minimapObjectGrid.clear();
    exploredCells.clear();
    updateMapNameLabel();
    loadMinimapData();
}

export function setMinimapEnabled(enabled) {
    minimapEnabled = enabled;

    if (canvas) {
        canvas.style.display = enabled ? 'block' : 'none';
        if (mapNameLabel) {
            mapNameLabel.style.display = enabled ? 'block' : 'none';
        }
        if (!enabled && ctx) {
            ctx.clearRect(0, 0, SIZE, SIZE);
        }
    }

    if (!enabled && fullCanvas) {
        fullCanvas.style.display = 'none';
        fullVisible = false;
    }
}

function drawFullMap(player, camera, mapData) {
    if (!fullCtx) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const item of mapData) {
        if (!item) continue;
        const position = parsePosition(item.position);
        const x = position.x;
        const z = position.z;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxZ - minZ, 1);
    const scale = Math.min(fullCanvas.width / width, fullCanvas.height / height);
    const offsetX = -minX;
    const offsetZ = -minZ;

    fullCtx.clearRect(0, 0, fullCanvas.width, fullCanvas.height);

    for (let i = 0; i < mapData.length; i++) {
        const item = mapData[i];
        if (!item) continue;
        const position = parsePosition(item.position);
        const x = position.x;
        const z = position.z;
        if (!isExplored(x, z)) continue;
        const saveKey = createSaveKeyForMapItem(item, i);
        if (removedObjectKeys.has(saveKey)) continue;
        let color = 'white';
        if (item.type === 'wall') {
            color = '#888';
        } else if (item.type === 'door') {
            color = '#00f';
        }
        fullCtx.fillStyle = color;
        const sx = (x + offsetX) * scale;
        const sy = (z + offsetZ) * scale;
        fullCtx.fillRect(sx - 2, sy - 2, 4, 4);
    }

    const px = (player.position.x + offsetX) * scale;
    const py = (player.position.z + offsetZ) * scale;
    fullCtx.fillStyle = 'red';
    fullCtx.beginPath();
    fullCtx.arc(px, py, 4, 0, Math.PI * 2);
    fullCtx.fill();

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    fullCtx.strokeStyle = 'red';
    fullCtx.beginPath();
    fullCtx.moveTo(px, py);
    fullCtx.lineTo(px + dir.x * 10, py + dir.z * 10);
    fullCtx.stroke();
}

function markExplored(player, range, objects) {
    if (!objects || !Array.isArray(objects)) {
        return;
    }

    const px = player.position.x;
    const pz = player.position.z;
    exploredCells.add(`${Math.floor(px)},${Math.floor(pz)}`);

    const occluders = extractOccluderBounds(objects);
    if (!occluders.length) {
        // No walls, reveal in a simple radius
        const r = Math.floor(range);
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                exploredCells.add(`${Math.floor(px) + dx},${Math.floor(pz) + dz}`);
            }
        }
        return;
    }

    const steps = 64;
    const angleStep = (Math.PI * 2) / steps;
    const stepSize = 0.25;
    const originY = Number.isFinite(player.position?.y)
        ? player.position.y
        : playerHeightFallback;
    rayOrigin.set(px, originY, pz);

    for (let i = 0; i < steps; i++) {
        const angle = i * angleStep;
        rayDirection.set(Math.cos(angle), 0, Math.sin(angle));
        rayHelper.origin.copy(rayOrigin);
        rayHelper.direction.copy(rayDirection);

        let maxDistance = range;
        let occluderTileX = null;
        let occluderTileZ = null;
        for (const entry of occluders) {
            const box = entry && entry.box;
            if (!box || box.containsPoint(rayOrigin)) continue;
            const intersection = rayHelper.intersectBox(box, rayIntersection);
            if (!intersection) continue;
            const dist = Math.hypot(intersection.x - rayOrigin.x, intersection.z - rayOrigin.z);
            if (dist < maxDistance) {
                maxDistance = dist;
                occluderTileX = entry && Number.isFinite(entry.tileX) ? entry.tileX : null;
                occluderTileZ = entry && Number.isFinite(entry.tileZ) ? entry.tileZ : null;
            }
        }

        const limit = Math.max(0, maxDistance - 0.05);
        for (let dist = 0; dist <= limit; dist += stepSize) {
            const x = px + rayDirection.x * dist;
            const z = pz + rayDirection.z * dist;
            exploredCells.add(`${Math.floor(x)},${Math.floor(z)}`);
        }
        if (maxDistance < range) {
            const blockX = px + rayDirection.x * maxDistance;
            const blockZ = pz + rayDirection.z * maxDistance;
            exploredCells.add(`${Math.floor(blockX)},${Math.floor(blockZ)}`);
            if (occluderTileX !== null && occluderTileZ !== null) {
                exploredCells.add(`${occluderTileX},${occluderTileZ}`);
            }
        }
    }
}

function isExplored(x, z) {
    return exploredCells.has(`${Math.floor(x)},${Math.floor(z)}`);
}

function extractOccluderBounds(objects) {
    const bounds = [];
    for (const obj of objects) {
        if (!obj || !obj.userData) continue;

        const { userData } = obj;
        const rules = userData.rules || {};
        const collidable = rules.collidable === true || userData.collidable === true;
        const occludes = userData.type === 'wall' || collidable;
        if (!occludes) continue;

        const box = getCachedBoundingBox(obj);
        if (!box) continue;

        let tileX = null;
        let tileZ = null;
        const pos = obj.position;
        if (pos) {
            const x = Number.isFinite(pos.x) ? Math.round(pos.x) : null;
            const z = Number.isFinite(pos.z) ? Math.round(pos.z) : null;
            if (x !== null && z !== null) {
                tileX = x;
                tileZ = z;
            }
        }

        bounds.push({ box, tileX, tileZ });
    }
    return bounds;
}

function getCachedBoundingBox(obj) {
    const ud = obj.userData || (obj.userData = {});
    if (typeof obj.updateMatrixWorld !== 'function') {
        const geo = ud.rules && Array.isArray(ud.rules.geometry) ? ud.rules.geometry : [1, 1, 1];
        const halfX = (Number(geo[0]) || 1) / 2;
        const halfY = (Number(geo[1]) || 1) / 2;
        const halfZ = (Number(geo[2]) || 1) / 2;
        const pos = obj.position || { x: 0, y: 0, z: 0 };
        const box = ud._bbox instanceof THREE.Box3 ? ud._bbox : new THREE.Box3();
        box.min.set(pos.x - halfX, pos.y - halfY, pos.z - halfZ);
        box.max.set(pos.x + halfX, pos.y + halfY, pos.z + halfZ);
        ud._bbox = box;
        return box;
    }

    const hasBox = ud._bbox instanceof THREE.Box3;
    const posMatches = hasBox && ud._bboxPos instanceof THREE.Vector3 && ud._bboxPos.equals(obj.position);
    const quatMatches = hasBox && ud._bboxQuat instanceof THREE.Quaternion && ud._bboxQuat.equals(obj.quaternion);
    const scaleMatches = hasBox && ud._bboxScale instanceof THREE.Vector3 && ud._bboxScale.equals(obj.scale);

    if (!hasBox || !posMatches || !quatMatches || !scaleMatches) {
        obj.updateMatrixWorld(true);
        const box = hasBox ? ud._bbox : new THREE.Box3();
        box.setFromObject(obj);
        ud._bbox = box;
        ud._bboxPos = (ud._bboxPos || new THREE.Vector3()).copy(obj.position);
        ud._bboxQuat = (ud._bboxQuat || new THREE.Quaternion()).copy(obj.quaternion);
        ud._bboxScale = (ud._bboxScale || new THREE.Vector3()).copy(obj.scale);
    }

    return ud._bbox;
}


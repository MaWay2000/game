let canvas, ctx;
let fullCanvas, fullCtx;
let fullVisible = false;
let fullMapData = null;
let mapSource = 'maps/home.json';
let minimapEnabled = true;
const SIZE = 150; // minimap size in pixels
const SCALE = 4; // pixels per world unit
// Track explored cells so the full map only reveals visited areas
const exploredCells = new Set();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const rayHelper = new THREE.Ray();
const rayIntersection = new THREE.Vector3();
const playerHeightFallback = 1.6;
const removedObjectKeys = new Set();

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
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
}

export function updateMinimap(player, camera, objects) {
    if (!ctx || !minimapEnabled) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const half = SIZE / 2;
    const range = half / SCALE; // world units that fit in minimap radius
    // Mark nearby cells as explored based on line of sight
    markExplored(player, range, objects);
    // Draw walls that have been explored
    ctx.fillStyle = '#888';
    for (const obj of objects) {
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

    // Draw other explored objects relative to player position
    for (const obj of objects) {
        if (!obj || !obj.position || !obj.userData) continue;
        if (obj.userData.type === 'wall') continue;
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
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(half, half, 4, 0, Math.PI * 2);
    ctx.fill();

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
                const res = await fetch(mapSource);
                fullMapData = await res.json();
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
    exploredCells.clear();
}

export function setMinimapEnabled(enabled) {
    minimapEnabled = enabled;

    if (canvas) {
        canvas.style.display = enabled ? 'block' : 'none';
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
        for (const box of occluders) {
            if (!box || box.containsPoint(rayOrigin)) continue;
            const intersection = rayHelper.intersectBox(box, rayIntersection);
            if (!intersection) continue;
            const dist = Math.hypot(intersection.x - rayOrigin.x, intersection.z - rayOrigin.z);
            if (dist < maxDistance) {
                maxDistance = dist;
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

        bounds.push(box);
    }
    return bounds;
}

function getCachedBoundingBox(obj) {
    const ud = obj.userData || (obj.userData = {});
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


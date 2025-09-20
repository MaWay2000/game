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
    ctx.fillStyle = 'white';
    for (const obj of objects) {
        if (!obj || !obj.position || !obj.userData) continue;
        if (obj.userData.type === 'wall') continue;
        if (!isExplored(obj.position.x, obj.position.z)) continue;
        const dx = obj.position.x - player.position.x;
        const dz = obj.position.z - player.position.z;
        if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
        const x = half + dx * SCALE;
        const y = half + dz * SCALE;
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
        const [x, , z] = item.position;
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

    for (const item of mapData) {
        const [x, , z] = item.position;
        if (!isExplored(x, z)) continue;
        const color = item.type === 'wall' ? '#888' : 'white';
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

    for (let i = 0; i < steps; i++) {
        const angle = i * angleStep;
        const dirX = Math.cos(angle);
        const dirZ = Math.sin(angle);
        for (let dist = 0; dist <= range; dist += stepSize) {
            const x = px + dirX * dist;
            const z = pz + dirZ * dist;
            exploredCells.add(`${Math.floor(x)},${Math.floor(z)}`);
            if (hitsOccluder(x, z, occluders)) {
                break;
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

        bounds.push({
            minX: box.min.x,
            maxX: box.max.x,
            minZ: box.min.z,
            maxZ: box.max.z,
        });
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

function hitsOccluder(x, z, occluders) {
    for (const occluder of occluders) {
        if (x >= occluder.minX && x <= occluder.maxX && z >= occluder.minZ && z <= occluder.maxZ) {
            return true;
        }
    }
    return false;
}

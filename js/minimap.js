let canvas, ctx;
let fullCanvas, fullCtx;
let fullVisible = false;
let fullMapData = null;
const SIZE = 150; // minimap size in pixels
const SCALE = 4; // pixels per world unit

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
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const half = SIZE / 2;
    const range = half / SCALE; // world units that fit in minimap radius
    // Draw walls
    ctx.fillStyle = '#888';
    for (const obj of objects) {
        if (obj.userData && obj.userData.type === 'wall') {
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
    }

    // Draw other objects relative to player position
    ctx.fillStyle = 'white';
    for (const obj of objects) {
        if (obj.userData && obj.userData.type === 'wall') continue;
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
                const res = await fetch('saved_map.json');
                fullMapData = await res.json();
            } catch (e) {
                console.error('Failed to load full map data', e);
                fullMapData = [];
            }
        }
        drawFullMap(player, camera, fullMapData);
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

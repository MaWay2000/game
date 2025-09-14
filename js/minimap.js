let canvas, ctx;
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
}

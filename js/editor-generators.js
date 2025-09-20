// editor-generators.js

// --- DUNGEON GENERATION ---

// Generate grid + rooms (returns { grid, rooms })
export function generateDungeonGrid(width, height, roomCount, roomMinSize, roomMaxSize) {
    const grid = Array.from({ length: height }, () => Array(width).fill('wall'));
    const rooms = [];

    for (let i = 0; i < roomCount; i++) {
        const w = roomMinSize + Math.floor(Math.random() * (roomMaxSize - roomMinSize + 1));
        const h = roomMinSize + Math.floor(Math.random() * (roomMaxSize - roomMinSize + 1));
        const x = Math.floor(Math.random() * (width - w - 1)) + 1;
        const y = Math.floor(Math.random() * (height - h - 1)) + 1;

        let overlap = false;
        for (const r of rooms) {
            if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) {
                overlap = true;
                break;
            }
        }
        if (overlap) continue;

        rooms.push({ x, y, w, h });

        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                grid[y + dy][x + dx] = 'floor';
            }
        }
    }

    // Connect rooms with corridors (MST)
    connectRoomsWithMST(grid, rooms);

    return { grid, rooms };
}

function digCorridor(grid, from, to, fixed, axis) {
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
        if (axis === 'h') grid[fixed][i] = 'floor';
        else grid[i][fixed] = 'floor';
    }
}

function connectRoomsWithMST(grid, rooms) {
    function distance(a, b) {
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
        const bx = b.x + b.w / 2, by = b.y + b.h / 2;
        return Math.hypot(bx - ax, by - ay);
    }
    const edges = [];
    for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
            edges.push({ from: i, to: j, dist: distance(rooms[i], rooms[j]) });
        }
    }
    edges.sort((a, b) => a.dist - b.dist);

    const parent = rooms.map((_, i) => i);
    function find(x) {
        if (parent[x] === x) return x;
        parent[x] = find(parent[x]);
        return parent[x];
    }
    function union(a, b) {
        const rootA = find(a), rootB = find(b);
        if (rootA !== rootB) {
            parent[rootB] = rootA;
            return true;
        }
        return false;
    }

    edges.forEach(edge => {
        if (union(edge.from, edge.to)) {
            const roomA = rooms[edge.from], roomB = rooms[edge.to];            objects.push({ type: 'door', position: [doorX, 0.5, doorZ], rotation });
        });
    });


            const bx = Math.floor(roomB.x + roomB.w / 2);
            const by = Math.floor(roomB.y + roomB.h / 2);

            if (Math.random() < 0.5) {
                digCorridor(grid, ax, bx, ay, 'h');
                digCorridor(grid, ay, by, bx, 'v');
            } else {
                digCorridor(grid, ay, by, ax, 'v');
                digCorridor(grid, ax, bx, by, 'h');
            }
        }
    });
}

// --- Door helpers ---

function isInsideRoom(x, y, room) {
    return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

function validDoorPosition(grid, x, y, room) {
    if (isInsideRoom(x, y, room)) return false;
    let floorNeighbors = 0, insideRoomNeighbor = false, outsideRoomNeighbor = false;
    [
        { nx: x + 1, ny: y }, { nx: x - 1, ny: y },
        { nx: x, ny: y + 1 }, { nx: x, ny: y - 1 }
    ].forEach(({ nx, ny }) => {
        if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
            if (grid[ny][nx] === 'floor') {
                floorNeighbors++;
                if (isInsideRoom(nx, ny, room)) insideRoomNeighbor = true;
                else outsideRoomNeighbor = true;
            }
        }
    });
    if (floorNeighbors !== 2 || !(insideRoomNeighbor && outsideRoomNeighbor)) return false;
    const wallOpposites = [
        [{nx: x + 1, ny: y}, {nx: x - 1, ny: y}],
        [{nx: x, ny: y + 1}, {nx: x, ny: y - 1}]
    ];
    let hasProperWalls = false;
    for (const [first, second] of wallOpposites) {
        const firstWall = grid[first.ny]?.[first.nx] === 'wall';
        const secondWall = grid[second.ny]?.[second.nx] === 'wall';
        if (firstWall && secondWall) { hasProperWalls = true; break; }
    }
    return hasProperWalls;
}

// --- Dungeon grid to objects (walls, floors, DOORS) ---
export function dungeonToObjects(grid, rooms) {
    const scale = 1;
    const offsetX = Math.floor(grid[0].length * scale / 2);
    const offsetZ = Math.floor(grid.length * scale / 2);
    const objects = [];

    // Floor and walls
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
            const cell = grid[y][x];
            const posX = (x * scale) - offsetX;
            const posZ = (y * scale) - offsetZ;
            if (cell === 'floor') {
                objects.push({ type: 'terrain', position: [posX, 0.5, posZ] });
            } else {
                objects.push({ type: 'wall', position: [posX, 0.5, posZ] });
            }
        }
    }

    // Add doors
    rooms.forEach(room => {
        const corridorEdges = { top: [], bottom: [], left: [], right: [] };
        for (let x = room.x; x < room.x + room.w; x++) {
            if (room.y - 1 >= 0 && grid[room.y - 1][x] === 'floor')
                corridorEdges.top.push({ x, y: room.y - 1 });
            if (room.y + room.h < grid.length && grid[room.y + room.h][x] === 'floor')
                corridorEdges.bottom.push({ x, y: room.y + room.h });
        }
        for (let y = room.y; y < room.y + room.h; y++) {
            if (room.x - 1 >= 0 && grid[y][room.x - 1] === 'floor')
                corridorEdges.left.push({ x: room.x - 1, y });
            if (room.x + room.w < grid[0].length && grid[y][room.x + room.w] === 'floor')
                corridorEdges.right.push({ x: room.x + room.w, y });
        }
        Object.entries(corridorEdges).forEach(([side, positions]) => {
            const validPositions = positions.filter(pos => validDoorPosition(grid, pos.x, pos.y, room));
            if (validPositions.length === 0) return;
            const midIndex = Math.floor(validPositions.length / 2);
            const pos = validPositions[midIndex];
            let doorX, doorZ, rotation;
            if (side === 'top' || side === 'bottom') {
                doorX = (pos.x * scale) - offsetX;
                doorZ = (pos.y * scale) - offsetZ;
                rotation = 0;
            } else {
                doorX = (pos.x * scale) - offsetX;
                doorZ = (pos.y * scale) - offsetZ;
                rotation = Math.PI / 2;
            }
            objects.push({ type: 'door', position: [doorX, 1, doorZ], rotation });
        });
    });

    return objects;
}

// --- Top-level dungeon generator for editor ---
export function generateDungeonEditor(params = {}) {
    const width = params.width || 200;
    const height = params.height || 200;
    const roomCount = params.roomCount || 400;
    const roomMinSize = params.roomMinSize || 20;
    const roomMaxSize = params.roomMaxSize || 50;

    const { grid, rooms } = generateDungeonGrid(width, height, roomCount, roomMinSize, roomMaxSize);
    return dungeonToObjects(grid, rooms);
}

// --- (Optional) LANDSCAPE GENERATION EXAMPLE ---
export function generateLandscape(params = {}) {
    // Dummy landscape (flat grid of 'terrain'), adapt as needed
    const size = params.size || 30;
    const objects = [];
    for (let x = -size / 2; x < size / 2; x++) {
        for (let z = -size / 2; z < size / 2; z++) {
            objects.push({ type: 'terrain', position: [x, 0.5, z] });
        }
    }
    return objects;
}

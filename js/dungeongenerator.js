// dungeongenerator.js

function generateDungeonGrid(width, height, roomCount, minSize, maxSize, options = {}) {
    const grid = Array.from({ length: height }, () => Array(width).fill('wall'));
    const rooms = [];
    const skipChance = options.skipChance || 0;

    for (let i = 0; i < roomCount; i++) {
        const w = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
        const h = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
        const x = Math.floor(Math.random() * (width - w));
        const y = Math.floor(Math.random() * (height - h));

        const newRoom = { x, y, w, h };

        let overlaps = false;
        for (const other of rooms) {
            if (
                x < other.x + other.w + 2 &&
                x + w + 2 > other.x &&
                y < other.y + other.h + 2 &&
                y + h + 2 > other.y
            ) {
                overlaps = true;
                break;
            }
        }

        if (!overlaps) {
            rooms.push(newRoom);
            for (let r = y; r < y + h; r++) {
                for (let c = x; c < x + w; c++) {
                    grid[r][c] = 'floor';
                }
            }
        }
    }

    function carvePath(x1, y1, x2, y2) {
        let x = x1, y = y1;
        while (x !== x2) {
            if (Math.random() < skipChance) continue;
            grid[y][x] = 'floor';
            x += x < x2 ? 1 : -1;
        }
        while (y !== y2) {
            if (Math.random() < skipChance) continue;
            grid[y][x] = 'floor';
            y += y < y2 ? 1 : -1;
        }
        grid[y][x] = 'floor';
    }

    for (let i = 1; i < rooms.length; i++) {
        const prev = rooms[i - 1];
        const curr = rooms[i];
        const prevCenterX = Math.floor(prev.x + prev.w / 2);
        const prevCenterY = Math.floor(prev.y + prev.h / 2);
        const currCenterX = Math.floor(curr.x + curr.w / 2);
        const currCenterY = Math.floor(curr.y + curr.h / 2);
        carvePath(prevCenterX, prevCenterY, currCenterX, currCenterY);
    }

    return grid;
}

export { generateDungeonGrid };

const SAVE_STORAGE_KEY = 'onslaught:save-data';
const SAVE_VERSION = 1;

function hasLocalStorage() {
    try {
        return typeof window !== 'undefined' && !!window.localStorage;
    } catch (err) {
        console.debug('Local storage unavailable:', err);
        return false;
    }
}

function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    if (Number.isFinite(min) && numeric < min) {
        return min;
    }
    if (Number.isFinite(max) && numeric > max) {
        return max;
    }
    return numeric;
}

function sanitizeVector3(vector) {
    if (!vector || typeof vector !== 'object') {
        return null;
    }
    const x = clampNumber(vector.x ?? vector[0], -1e6, 1e6);
    const y = clampNumber(vector.y ?? vector[1], -1e6, 1e6);
    const z = clampNumber(vector.z ?? vector[2], -1e6, 1e6);
    if (x === null || y === null || z === null) {
        return null;
    }
    return { x, y, z };
}

function sanitizeRotation(rotation) {
    if (!rotation || typeof rotation !== 'object') {
        return null;
    }
    const yaw = clampNumber(rotation.yaw ?? rotation.y ?? rotation[1], -Math.PI * 8, Math.PI * 8);
    const pitch = clampNumber(rotation.pitch ?? rotation.x ?? rotation[0], -Math.PI / 2 * 4, Math.PI / 2 * 4);
    if (yaw === null || pitch === null) {
        return null;
    }
    return { yaw, pitch };
}

function sanitizePistolState(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }
    const maxClip = clampNumber(state.maxClip, 1, 999) ?? 10;
    const clipAmmo = clampNumber(state.clipAmmo, 0, maxClip) ?? maxClip;
    return {
        clipAmmo,
        maxClip
    };
}

function sanitizePlayerState(player) {
    if (!player || typeof player !== 'object') {
        return {};
    }
    const sanitized = {};
    const position = sanitizeVector3(player.position);
    if (position) {
        sanitized.position = position;
    }
    const rotation = sanitizeRotation(player.rotation);
    if (rotation) {
        sanitized.rotation = rotation;
    }
    const health = clampNumber(player.health, 0, 1000);
    if (health !== null) {
        sanitized.health = health;
    }
    const pistol = sanitizePistolState(player.pistol);
    if (pistol) {
        sanitized.pistol = pistol;
    }
    return sanitized;
}

function sanitizeRemovedKeys(keys) {
    if (!Array.isArray(keys)) {
        return [];
    }
    const result = [];
    const seen = new Set();
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key !== 'string' || !key) {
            continue;
        }
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(key);
    }
    return result;
}

function sanitizeWorldState(world) {
    if (!world || typeof world !== 'object') {
        return { removedObjectKeys: [] };
    }
    return {
        removedObjectKeys: sanitizeRemovedKeys(world.removedObjectKeys)
    };
}

export function readSaveData() {
    if (!hasLocalStorage()) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        const player = sanitizePlayerState(parsed.player);
        const world = sanitizeWorldState(parsed.world);
        const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now();
        return {
            version: SAVE_VERSION,
            timestamp,
            player,
            world
        };
    } catch (err) {
        console.debug('Unable to read saved progress:', err);
        return null;
    }
}

export function writeSaveData(data) {
    if (!hasLocalStorage()) {
        return false;
    }
    if (!data || typeof data !== 'object') {
        return false;
    }
    try {
        const payload = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            player: sanitizePlayerState(data.player),
            world: sanitizeWorldState(data.world)
        };
        window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.debug('Unable to write saved progress:', err);
        return false;
    }
}

export function clearSaveData() {
    if (!hasLocalStorage()) {
        return false;
    }
    try {
        window.localStorage.removeItem(SAVE_STORAGE_KEY);
        return true;
    } catch (err) {
        console.debug('Unable to clear saved progress:', err);
        return false;
    }
}

const SAVE_STORAGE_KEY = 'onslaught:save-data';
const STATS_STORAGE_KEY = 'onslaught:save-stats';
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

function sanitizeStatsState(stats) {
    if (!stats || typeof stats !== 'object') {
        return {};
    }
    const zombieKillCount = clampNumber(stats.zombieKillCount ?? stats.killCount, 0, 1000000);
    const coinCount = clampNumber(stats.coinCount ?? stats.coins, 0, 1000000);
    const sanitized = {};
    if (zombieKillCount !== null) {
        sanitized.zombieKillCount = Math.floor(zombieKillCount);
    }
    if (coinCount !== null) {
        sanitized.coinCount = Math.floor(coinCount);
    }
    return sanitized;
}

function hasStats(stats) {
    return !!stats && typeof stats === 'object' && Object.keys(stats).length > 0;
}

function readStatsBackup() {
    if (!hasLocalStorage()) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        const stats = sanitizeStatsState(parsed.stats);
        if (!hasStats(stats)) {
            return null;
        }
        return {
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
            stats
        };
    } catch (err) {
        console.debug('Unable to read saved stats backup:', err);
        return null;
    }
}

function writeStatsBackup(stats) {
    if (!hasLocalStorage()) {
        return false;
    }
    const sanitizedStats = sanitizeStatsState(stats);
    if (!hasStats(sanitizedStats)) {
        return false;
    }
    try {
        window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify({
            timestamp: Date.now(),
            stats: sanitizedStats
        }));
        return true;
    } catch (err) {
        console.warn('Unable to write saved stats backup:', err);
        return false;
    }
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

function sanitizeMapPath(path) {
    if (typeof path !== 'string') {
        return null;
    }
    const trimmed = path.trim();
    if (!trimmed || trimmed.includes('..') || trimmed.includes('://') || trimmed.startsWith('/') || trimmed.includes('\\')) {
        return null;
    }
    if (!/\.json$/i.test(trimmed)) {
        return null;
    }
    return trimmed;
}

function sanitizeRemovedKeysByMap(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    const result = {};
    for (const [mapPath, keys] of Object.entries(value)) {
        const sanitizedPath = sanitizeMapPath(mapPath);
        if (!sanitizedPath) {
            continue;
        }
        result[sanitizedPath] = sanitizeRemovedKeys(keys);
    }
    return result;
}

function sanitizeZombieState(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }
    if (typeof state.key !== 'string' || !state.key) {
        return null;
    }
    const position = sanitizeVector3(state.position);
    if (!position) {
        return null;
    }
    const hp = clampNumber(state.hp, 0, 10000);
    const rotation = clampNumber(state.rotation ?? state.rotationY ?? 0, -Math.PI * 8, Math.PI * 8) ?? 0;
    const sanitized = {
        key: state.key,
        type: typeof state.type === 'string' ? state.type : '',
        position,
        rotation,
        hp: hp === null ? 10 : hp
    };
    return sanitized;
}

function sanitizeZombieStatesByMap(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }
    const result = {};
    for (const [mapPath, states] of Object.entries(value)) {
        const sanitizedPath = sanitizeMapPath(mapPath);
        if (!sanitizedPath || !Array.isArray(states)) {
            continue;
        }
        const sanitizedStates = [];
        const seen = new Set();
        for (let i = 0; i < states.length; i++) {
            const state = sanitizeZombieState(states[i]);
            if (!state || seen.has(state.key)) {
                continue;
            }
            seen.add(state.key);
            sanitizedStates.push(state);
        }
        result[sanitizedPath] = sanitizedStates;
    }
    return result;
}

function sanitizeWorldState(world) {
    if (!world || typeof world !== 'object') {
        return { removedObjectKeys: [], removedObjectKeysByMap: {}, zombiesByMap: {}, killedZombieKeysByMap: {} };
    }
    const mapPath = sanitizeMapPath(world.mapPath);
    const removedObjectKeys = sanitizeRemovedKeys(world.removedObjectKeys);
    const removedObjectKeysByMap = sanitizeRemovedKeysByMap(world.removedObjectKeysByMap);
    const zombiesByMap = sanitizeZombieStatesByMap(world.zombiesByMap);
    const killedZombieKeysByMap = sanitizeRemovedKeysByMap(world.killedZombieKeysByMap);
    const sanitized = {
        removedObjectKeys,
        removedObjectKeysByMap,
        zombiesByMap,
        killedZombieKeysByMap
    };
    if (mapPath) {
        sanitized.mapPath = mapPath;
    }
    return sanitized;
}

export function readSaveData() {
    if (!hasLocalStorage()) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
        if (!raw) {
            const backup = readStatsBackup();
            if (!backup) {
                return null;
            }
            return {
                version: SAVE_VERSION,
                timestamp: backup.timestamp,
                player: {},
                world: sanitizeWorldState(null),
                stats: backup.stats
            };
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            const backup = readStatsBackup();
            if (!backup) {
                return null;
            }
            return {
                version: SAVE_VERSION,
                timestamp: backup.timestamp,
                player: {},
                world: sanitizeWorldState(null),
                stats: backup.stats
            };
        }
        const player = sanitizePlayerState(parsed.player);
        const world = sanitizeWorldState(parsed.world);
        const backup = readStatsBackup();
        const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now();
        const savedStats = sanitizeStatsState(parsed.stats);
        const stats = (backup && (!hasStats(savedStats) || backup.timestamp >= timestamp))
            ? { ...savedStats, ...backup.stats }
            : { ...(backup ? backup.stats : {}), ...savedStats };
        return {
            version: SAVE_VERSION,
            timestamp,
            player,
            world,
            stats
        };
    } catch (err) {
        console.debug('Unable to read saved progress:', err);
        const backup = readStatsBackup();
        if (!backup) {
            return null;
        }
        return {
            version: SAVE_VERSION,
            timestamp: backup.timestamp,
            player: {},
            world: sanitizeWorldState(null),
            stats: backup.stats
        };
    }
}

export function writeSaveData(data) {
    if (!hasLocalStorage()) {
        return false;
    }
    if (!data || typeof data !== 'object') {
        return false;
    }
    const stats = sanitizeStatsState(data.stats);
    const statsSaved = writeStatsBackup(stats);
    try {
        const payload = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            player: sanitizePlayerState(data.player),
            world: sanitizeWorldState(data.world),
            stats
        };
        window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.warn('Unable to write saved progress:', err);
        return statsSaved || writeStatsBackup(stats);
    }
}

export function clearSaveData() {
    if (!hasLocalStorage()) {
        return false;
    }
    try {
        window.localStorage.removeItem(SAVE_STORAGE_KEY);
        window.localStorage.removeItem(STATS_STORAGE_KEY);
        return true;
    } catch (err) {
        console.debug('Unable to clear saved progress:', err);
        return false;
    }
}

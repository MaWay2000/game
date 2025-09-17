const DOOR_MAX_HP = 1;
const DOOR_SINK_DURATION = 5; // seconds
const EXTRA_SINK_DEPTH = 0.2;

const registeredDoors = [];

function ensureDoorUserData(door) {
    if (!door) return null;
    const userData = door.userData || (door.userData = {});
    if (!userData.rules) {
        userData.rules = {};
    }
    let doorData = userData.door;
    if (!doorData || typeof doorData !== 'object') {
        doorData = {};
        userData.door = doorData;
    }
    return doorData;
}

function computeSinkDistance(door) {
    const ruleHeight = door?.userData?.rules?.geometry?.[1];
    if (Number.isFinite(ruleHeight) && ruleHeight > 0) {
        return ruleHeight + EXTRA_SINK_DEPTH;
    }
    if (typeof THREE !== 'undefined' && THREE.Box3) {
        const box = new THREE.Box3().setFromObject(door);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (Number.isFinite(size.y) && size.y > 0) {
            return size.y + EXTRA_SINK_DEPTH;
        }
    }
    return 2 + EXTRA_SINK_DEPTH;
}

export function resetDoors() {
    registeredDoors.length = 0;
}

export function registerDoor(door) {
    if (!door) return;
    const data = ensureDoorUserData(door);
    if (!data) return;

    data.maxHp = DOOR_MAX_HP;
    data.hp = DOOR_MAX_HP;
    data.sinking = false;
    data.sinkElapsed = 0;
    data.sinkDuration = DOOR_SINK_DURATION;
    data.startY = door.position?.y ?? 0;
    data.sinkDistance = computeSinkDistance(door);
    data.destroyed = false;
    door.userData._removed = false;
    if (!door.userData.rules.collidable) {
        door.userData.rules.collidable = true;
    }

    if (!registeredDoors.includes(door)) {
        registeredDoors.push(door);
    }
}

function beginDoorSink(door, data) {
    if (!door || !data) return;
    data.hp = 0;
    data.sinking = true;
    data.sinkElapsed = 0;
    data.startY = door.position?.y ?? 0;
    data.sinkDistance = computeSinkDistance(door);
}

function finalizeDoorRemoval(door, data) {
    if (!door || !data) return;
    data.destroyed = true;
    data.sinking = false;
    data.sinkElapsed = data.sinkDuration;
    if (door.userData?.rules) {
        door.userData.rules.collidable = false;
    }
    door.userData._removed = true;
    door.visible = false;
    if (door.parent) {
        door.parent.remove(door);
    }
}

export function damageDoor(door, amount = 1) {
    const data = ensureDoorUserData(door);
    if (!data || data.destroyed) {
        return false;
    }
    if (data.sinking) {
        return false;
    }

    const damageAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
    data.hp = (data.hp ?? DOOR_MAX_HP) - damageAmount;

    if (data.hp <= 0) {
        beginDoorSink(door, data);
        return true;
    }
    return false;
}

export function updateDoors(delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
        return;
    }

    for (let i = registeredDoors.length - 1; i >= 0; i--) {
        const door = registeredDoors[i];
        if (!door || !door.userData) {
            registeredDoors.splice(i, 1);
            continue;
        }
        const data = door.userData.door;
        if (!data) {
            registeredDoors.splice(i, 1);
            continue;
        }
        if (data.destroyed) {
            registeredDoors.splice(i, 1);
            continue;
        }
        if (!data.sinking) {
            continue;
        }

        const duration = Number.isFinite(data.sinkDuration) && data.sinkDuration > 0
            ? data.sinkDuration
            : DOOR_SINK_DURATION;
        data.sinkElapsed += delta;
        const progress = Math.min(Math.max(data.sinkElapsed / duration, 0), 1);
        const sinkDistance = Number.isFinite(data.sinkDistance) && data.sinkDistance > 0
            ? data.sinkDistance
            : computeSinkDistance(door);

        const startY = data.startY ?? (door.position?.y ?? 0);
        if (door.position) {
            door.position.y = startY - sinkDistance * progress;
        }

        if (progress >= 1) {
            finalizeDoorRemoval(door, data);
            registeredDoors.splice(i, 1);
        }
    }
}

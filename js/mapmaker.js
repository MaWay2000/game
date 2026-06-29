const canvas = document.getElementById('editorCanvas');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

// Scene and Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
camera.position.set(0, 18, 18);
camera.lookAt(0, 0, 0);

const cameraContainer = new THREE.Object3D();
cameraContainer.add(camera);
scene.add(cameraContainer);

// Lights
scene.add(new THREE.AmbientLight(0x404040));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// Grid and Ground
scene.add(new THREE.GridHelper(100, 100));
const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial({ visible: false })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.userData.isGround = true;
scene.add(groundPlane);

// Add GUI button for landscape generation
const button = document.createElement('button');
button.innerText = 'Generate Landscape';
button.style.position = 'absolute';
button.style.top = '10px';
button.style.right = '10px';
button.style.zIndex = '1000';
button.style.padding = '10px';
button.style.backgroundColor = '#444';
button.style.color = '#fff';
button.style.border = 'none';
button.style.cursor = 'pointer';
document.body.appendChild(button);

button.addEventListener('click', () => {
    generateLandscape();
});

// Add GUI button for dungeon generation
const dungeonButton = document.createElement('button');
dungeonButton.innerText = 'Generate Dungeon';
dungeonButton.style.position = 'absolute';
dungeonButton.style.top = '50px';
dungeonButton.style.right = '10px';
dungeonButton.style.zIndex = '1000';
dungeonButton.style.padding = '10px';
dungeonButton.style.backgroundColor = '#444';
dungeonButton.style.color = '#fff';
dungeonButton.style.border = 'none';
dungeonButton.style.cursor = 'pointer';
document.body.appendChild(dungeonButton);

dungeonButton.addEventListener('click', () => {
    showDungeonSettingsPopup();
});

// --- UNIVERSAL OBJECT LOADING ---
let objectTypeList = []; // List of .json files (type names)
let objectDataByType = {}; // type => [object, ...]
let allObjectData = {}; // id => object definition
let allGeometries = {};
let allMaterials = {};
let allModels = {};
let allModelsLoaded = {};
let currentType = '';
let currentObjectId = '';
let currentPosition = new THREE.Vector3(0, 0.5, 0);
let currentRotation = 0;
let tempItem = null;
let objects = [];
let selectedObject = null;
const keys = {};
let isMouseDown = false;
let teleportSettingsContainer = null;
let teleportTargetSelect = null;
let pendingTeleportTarget = null;
const TELEPORT_OBJECT_TYPES = new Set(['3d car', 'teleport']);
const MAP_MANIFEST_PATH = 'maps/index.json';
const DEFAULT_MAP_OPTIONS = [
    { value: 'maps/home.json', label: 'Home' },
    { value: 'saved_map.json', label: 'Saved Map' }
];
const DEFAULT_DUNGEON_SETTINGS = {
    mapSize: 72,
    zombieCount: 20,
    rooms: 80,
    teleportTargetMap: 'saved_map.json'
};

function isTeleportType(type) {
    return TELEPORT_OBJECT_TYPES.has(type);
}

function getObjectDisplayName(obj) {
    if (!obj) return '';
    if (obj.id === '3d car') return 'Teleport';
    return obj.name || obj.id;
}

function getMapOptions() {
    const mapSelect = document.getElementById('mapSelect');
    if (!mapSelect) return [];
    return Array.from(mapSelect.options).map(option => ({
        value: option.value,
        label: option.textContent || option.value
    })).filter(option => option.value);
}

function isValidMapPath(path) {
    return typeof path === 'string' &&
        /\.json$/i.test(path) &&
        !path.includes('..') &&
        !path.includes('://') &&
        !path.includes('\\') &&
        path !== MAP_MANIFEST_PATH;
}

function formatMapLabel(path) {
    const fileName = String(path || '').split('/').pop() || path;
    const baseName = fileName.replace(/\.json$/i, '');
    return baseName
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function addMapOption(mapOptions, seen, value, label = null) {
    if (!isValidMapPath(value) || seen.has(value)) {
        return;
    }
    seen.add(value);
    mapOptions.push({
        value,
        label: label || formatMapLabel(value)
    });
}

async function readMapManifest() {
    try {
        const response = await fetch(MAP_MANIFEST_PATH + '?v=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            return [];
        }
        return data.map(entry => {
            if (typeof entry === 'string') {
                return { value: entry, label: formatMapLabel(entry) };
            }
            if (entry && typeof entry === 'object') {
                const value = entry.path || entry.value;
                return { value, label: entry.label || formatMapLabel(value) };
            }
            return null;
        }).filter(Boolean);
    } catch (err) {
        console.warn('Unable to load map manifest:', err);
        return [];
    }
}

async function readLocalMapDirectory() {
    try {
        const response = await fetch('maps/?v=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
            return [];
        }
        const html = await response.text();
        const matches = Array.from(html.matchAll(/href=["']([^"']+\.json)["']/gi));
        return matches.map(match => {
            const href = decodeURIComponent(match[1]);
            const fileName = href.split('/').pop();
            if (!fileName) return null;
            return {
                value: `maps/${fileName}`,
                label: formatMapLabel(fileName)
            };
        }).filter(Boolean);
    } catch (err) {
        return [];
    }
}

function populateMapSelect(mapOptions) {
    const mapSelect = document.getElementById('mapSelect');
    if (!mapSelect) return;
    const previousValue = mapSelect.value || getCurrentMapPath();
    mapSelect.innerHTML = '';
    let hasPreviousValue = false;
    mapOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        mapSelect.appendChild(opt);
        if (option.value === previousValue) {
            hasPreviousValue = true;
        }
    });
    if (previousValue && !hasPreviousValue && isValidMapPath(previousValue)) {
        const opt = document.createElement('option');
        opt.value = previousValue;
        opt.textContent = formatMapLabel(previousValue);
        mapSelect.appendChild(opt);
        hasPreviousValue = true;
    }
    if (hasPreviousValue) {
        mapSelect.value = previousValue;
    }
}

async function loadMapList() {
    const mapOptions = [];
    const seen = new Set();
    DEFAULT_MAP_OPTIONS.forEach(option => addMapOption(mapOptions, seen, option.value, option.label));

    const manifestOptions = await readMapManifest();
    manifestOptions.forEach(option => addMapOption(mapOptions, seen, option.value, option.label));

    const directoryOptions = await readLocalMapDirectory();
    directoryOptions.forEach(option => addMapOption(mapOptions, seen, option.value, option.label));

    populateMapSelect(mapOptions);
    updateTeleportSettingsVisibility();
}

function getCurrentMapPath() {
    const mapSelect = document.getElementById('mapSelect');
    return mapSelect && mapSelect.value ? mapSelect.value : 'maps/home.json';
}

function getDefaultTeleportTarget() {
    const options = getMapOptions();
    const currentMap = getCurrentMapPath();
    const differentMap = options.find(option => option.value !== currentMap);
    return differentMap ? differentMap.value : (options[0] ? options[0].value : 'saved_map.json');
}

function normalizeTeleportData(entry) {
    const source = entry && typeof entry === 'object' ? entry.teleport : null;
    const targetMap = source && typeof source.targetMap === 'string'
        ? source.targetMap
        : (entry && typeof entry.targetMap === 'string' ? entry.targetMap : null);
    if (!targetMap) return null;
    return { targetMap };
}

function applyEntryUserData(item, entry) {
    item.userData.type = entry.type;
    const teleport = normalizeTeleportData(entry);
    if (teleport) {
        item.userData.teleport = teleport;
    }
}

function getObjectTeleportTarget(obj) {
    return obj?.userData?.teleport?.targetMap || obj?.userData?.targetMap || getDefaultTeleportTarget();
}

function setObjectTeleportTarget(obj, targetMap) {
    if (!obj || !isTeleportType(obj.userData?.type) || typeof targetMap !== 'string' || !targetMap) {
        return;
    }
    obj.userData.teleport = {
        ...(obj.userData.teleport || {}),
        targetMap
    };
}

function refreshTeleportTargetOptions(selectedValue) {
    if (!teleportTargetSelect) return;
    const value = selectedValue || pendingTeleportTarget || getDefaultTeleportTarget();
    const options = getMapOptions();
    teleportTargetSelect.innerHTML = '';
    let hasSelectedValue = false;
    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        teleportTargetSelect.appendChild(opt);
        if (option.value === value) {
            hasSelectedValue = true;
        }
    });
    if (value && !hasSelectedValue) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        teleportTargetSelect.appendChild(opt);
    }
    teleportTargetSelect.value = value;
    pendingTeleportTarget = value;
}

function initTeleportSettingsUI() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || teleportSettingsContainer) return;

    teleportSettingsContainer = document.createElement('div');
    teleportSettingsContainer.style.display = 'none';
    teleportSettingsContainer.style.margin = '10px 0';

    const label = document.createElement('label');
    label.htmlFor = 'teleportTargetSelect';
    label.textContent = 'Teleport Target:';
    teleportSettingsContainer.appendChild(label);

    teleportTargetSelect = document.createElement('select');
    teleportTargetSelect.id = 'teleportTargetSelect';
    teleportTargetSelect.style.marginLeft = '6px';
    teleportTargetSelect.addEventListener('change', () => {
        pendingTeleportTarget = teleportTargetSelect.value;
        if (selectedObject) {
            setObjectTeleportTarget(selectedObject, pendingTeleportTarget);
        }
    });
    teleportSettingsContainer.appendChild(teleportTargetSelect);

    const saveButton = Array.from(sidebar.querySelectorAll('button')).find(btn => btn.textContent.includes('Save'));
    if (saveButton && saveButton.nextSibling) {
        sidebar.insertBefore(teleportSettingsContainer, saveButton.nextSibling);
    } else {
        sidebar.appendChild(teleportSettingsContainer);
    }
}

function updateTeleportSettingsVisibility() {
    initTeleportSettingsUI();
    if (!teleportSettingsContainer) return;
    const activeType = selectedObject?.userData?.type || currentObjectId;
    const visible = isTeleportType(activeType);
    teleportSettingsContainer.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    const targetMap = selectedObject
        ? getObjectTeleportTarget(selectedObject)
        : (pendingTeleportTarget || getDefaultTeleportTarget());
    refreshTeleportTargetOptions(targetMap);
}

// Load ALL object types at startup
function loadAllTypes() {
    const loadObjects = fetch('objects.json').then(res => res.json());
    const loadZombies = fetch('zombies.json')
        .then(res => res.ok ? res.json() : [])
        .catch(err => {
            console.warn('Failed to load zombies.json for mapmaker:', err);
            return [];
        });

    Promise.all([loadObjects, loadZombies])
        .then(([objects, zombies]) => {
            objectTypeList = ['objects'];
            objectDataByType.objects = objects;
            objects.concat(zombies).forEach(obj => {
                allObjectData[obj.id] = obj;
                // Pre-cache geometry/material/model
                allGeometries[obj.id] = new THREE.BoxGeometry(...(obj.size || [1, 1, 1]));
                allMaterials[obj.id] = new THREE.MeshLambertMaterial({
                    color: obj.color || '#999999',
                    opacity: 0.5,
                    transparent: true,
                });
            });
            populateTypeDropdown();
        })
        .catch(err => {
            console.error('Failed to load objects.json:', err);
            alert('Failed to load objects.json');
        });
}

function populateTypeDropdown() {
    const typeSelect = document.getElementById('typeSelect');
    typeSelect.innerHTML = '';
    objectTypeList.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        typeSelect.appendChild(opt);
    });
    if (objectTypeList.length > 0) {
        typeSelect.value = objectTypeList[0];
        loadObjectList(objectTypeList[0]);
    }
}

function loadObjectList(type) {
    const objList = objectDataByType[type] || [];
    const objectSelect = document.getElementById('objectSelect');
    objectSelect.innerHTML = '';
    objList.forEach(obj => {
        const opt = document.createElement('option');
        opt.value = obj.id;
        opt.textContent = getObjectDisplayName(obj);
        objectSelect.appendChild(opt);
    });
    if (objList.length > 0) {
        objectSelect.value = objList[0].id;
        currentType = type;
        currentObjectId = objList[0].id;
        prepareObject(objList[0]);
        updateTeleportSettingsVisibility();
    }
}

document.getElementById('typeSelect').addEventListener('change', function(e) {
    loadObjectList(e.target.value);
});

document.getElementById('objectSelect').addEventListener('change', function(e) {
    const obj = (objectDataByType[currentType] || []).find(o => o.id === e.target.value);
    if (obj) {
        currentObjectId = obj.id;
        prepareObject(obj);
        updateTeleportSettingsVisibility();
    }
});

document.getElementById('mapSelect').addEventListener('change', () => {
    updateTeleportSettingsVisibility();
});

// Prepare object geometry/material/model for tempItem
function prepareObject(obj) {
    if (tempItem) scene.remove(tempItem);

    if (obj.model && allModels[obj.id]) {
        tempItem = allModels[obj.id].clone(true);
        tempItem.traverse(node => {
            if (node.isMesh) {
                node.material = node.material.clone();
                node.material.transparent = true;
                node.material.opacity = 0.5;
            }
        });
        tempItem.position.copy(currentPosition);
        tempItem.rotation.y = currentRotation;
        scene.add(tempItem);
    } else if (allGeometries[obj.id] && allMaterials[obj.id]) {
        tempItem = new THREE.Mesh(allGeometries[obj.id], allMaterials[obj.id]);
        tempItem.position.copy(currentPosition);
        tempItem.rotation.y = currentRotation;
        scene.add(tempItem);
    }
}

function updateSelectedObject() {
    const objectSelect = document.getElementById('objectSelect');
    const obj = (objectDataByType[currentType] || []).find(o => o.id === objectSelect.value);
    if (obj) {
        currentObjectId = obj.id;
        prepareObject(obj);
    }
}

function updateTempItemMovement(key) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

    if (key === 'ArrowUp') currentPosition.addScaledVector(dir, 1);
    if (key === 'ArrowDown') currentPosition.addScaledVector(dir, -1);
    if (key === 'ArrowLeft') currentPosition.addScaledVector(left, 1);
    if (key === 'ArrowRight') currentPosition.addScaledVector(right, 1);

    currentPosition.x = Math.round(currentPosition.x);
    currentPosition.z = Math.round(currentPosition.z);
    if (tempItem) tempItem.position.copy(currentPosition);
}

function updateMovement() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

    if (keys['KeyW']) cameraContainer.position.addScaledVector(dir, 1);
    if (keys['KeyS']) cameraContainer.position.addScaledVector(dir, -1);
    if (keys['KeyA']) cameraContainer.position.addScaledVector(left, 1);
    if (keys['KeyD']) cameraContainer.position.addScaledVector(right, 1);

    cameraContainer.position.x = Math.round(cameraContainer.position.x);
    cameraContainer.position.z = Math.round(cameraContainer.position.z);
}

function addSelectedObjectFromData(entry) {
    const obj = allObjectData[entry.type];
    let item;
    if (obj && obj.model && allModels[obj.id]) {
        item = allModels[obj.id].clone(true);
        item.position.fromArray(entry.position);
        item.rotation.y = entry.rotation || 0;
        applyEntryUserData(item, entry);
        scene.add(item);
        objects.push(item);
    } else if (obj && allGeometries[obj.id] && allMaterials[obj.id]) {
        const mat = allMaterials[obj.id].clone();
        mat.opacity = 1;
        mat.transparent = false;
        item = new THREE.Mesh(allGeometries[obj.id], mat);
        item.position.fromArray(entry.position);
        item.rotation.y = entry.rotation || 0;
        applyEntryUserData(item, entry);
        scene.add(item);
        objects.push(item);
    } else {
        console.warn(`Unknown object type: ${entry.type}`);
        return;
    }
}

function addSelectedObject() {
    if (!tempItem) return;
    const entry = {
        position: tempItem.position.toArray(),
        rotation: currentRotation,
        type: currentObjectId
    };
    if (isTeleportType(currentObjectId)) {
        entry.teleport = {
            targetMap: pendingTeleportTarget || getDefaultTeleportTarget()
        };
    }
    addSelectedObjectFromData(entry);
    updateTeleportSettingsVisibility();
}

function removeObject() {
    if (selectedObject) {
        scene.remove(selectedObject);
        objects = objects.filter(o => o !== selectedObject);
        selectedObject = null;
        updateTeleportSettingsVisibility();
    }
}

window.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects([groundPlane, ...objects], true);

    if (selectedObject) {
        selectedObject.traverse(node => {
            if (node.material && node.material.emissive) {
                node.material.emissive.set(0x000000);
            }
        });
        selectedObject = null;
    }

    if (intersects.length > 0) {
        const hit = intersects[0].point;
        currentPosition.set(Math.round(hit.x), 0.5, Math.round(hit.z));
        if (tempItem) tempItem.position.copy(currentPosition);

        let target = intersects[0].object;
        while (target.parent && !objects.includes(target)) target = target.parent;

        if (objects.includes(target)) {
            selectedObject = target;
            selectedObject.traverse(node => {
                if (node.material && node.material.emissive) {
                    node.material = node.material.clone();
                    node.material.emissive.set(0xff0000);
                }
            });
        }
    }
    updateTeleportSettingsVisibility();
});

window.addEventListener('keydown', (e) => {
    if (!keys[e.code]) {
        keys[e.code] = true;
        if (e.code.startsWith('Arrow')) updateTempItemMovement(e.code);
        if (e.code === 'Space') addSelectedObject();
        if (e.code === 'Delete') removeObject();
        if (e.code === 'KeyR') {
            currentRotation += Math.PI / 2;
            if (currentRotation >= Math.PI * 2) currentRotation = 0;
            if (tempItem) tempItem.rotation.y = currentRotation;
        }
        if (e.code === 'KeyG') {
            generateLandscape();
        }
    }
});

window.addEventListener('keyup', (e) => keys[e.code] = false);

document.addEventListener('mousedown', () => isMouseDown = true);
document.addEventListener('mouseup', () => isMouseDown = false);
document.addEventListener('mousemove', (e) => {
    if (isMouseDown) {
        cameraContainer.rotation.y -= e.movementX * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x - e.movementY * 0.002));
    }
});

window.addEventListener('wheel', e => camera.position.y += e.deltaY * 0.01);

window.addEventListener('resize', () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
});

function saveMap() {
    const mapData = objects.map(obj => {
        const entry = {
            position: obj.position.toArray(),
            rotation: obj.rotation.y,
            type: obj.userData.type || 'unknown'
        };
        if (isTeleportType(entry.type)) {
            const targetMap = getObjectTeleportTarget(obj);
            if (targetMap) {
                entry.teleport = { targetMap };
            }
        }
        return entry;
    });

    const json = JSON.stringify(mapData, null, 2);
    saveMapJson(json).catch(err => alert('Error saving map: ' + err));
}

async function saveMapJson(json) {
    const mapSelect = document.getElementById('mapSelect');
    const selectedPath = mapSelect && mapSelect.value ? mapSelect.value : 'saved_map.json';
    const suggestedName = selectedPath.split('/').pop() || 'saved_map.json';

    if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: 'JSON map file',
                accept: { 'application/json': ['.json'] }
            }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        await loadMapList();
        alert(`Map saved: ${suggestedName}`);
        return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await loadMapList();
    alert(`Map exported: ${suggestedName}`);
}

function loadMap(path = 'saved_map.json') {
    const requestPath = path + (path.includes('?') ? '&' : '?') + 'v=' + Date.now();
    fetch(requestPath, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) {
                throw new Error(`${res.status} ${res.statusText}`);
            }
            return res.json();
        })
        .then(data => {
            clearMap();
            data.forEach(entry => addSelectedObjectFromData(entry));
            fitCameraToMap();
            updateTeleportSettingsVisibility();
            alert(`Map loaded: ${path}`);
        })
        .catch(err => alert('Error loading map: ' + err));
}

function loadSelectedMap() {
    const mapSelect = document.getElementById('mapSelect');
    const path = mapSelect && mapSelect.value ? mapSelect.value : 'saved_map.json';
    loadMap(path);
}

function fitCameraToMap() {
    if (!objects.length) {
        cameraContainer.position.set(0, 0, 0);
        camera.position.set(0, 18, 18);
        camera.lookAt(0, 0, 0);
        return;
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    objects.forEach(obj => {
        minX = Math.min(minX, obj.position.x);
        maxX = Math.max(maxX, obj.position.x);
        minZ = Math.min(minZ, obj.position.z);
        maxZ = Math.max(maxZ, obj.position.z);
    });

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 20);
    cameraContainer.position.set(centerX, 0, centerZ);
    camera.position.set(0, Math.min(Math.max(span * 0.5, 18), 180), Math.min(Math.max(span * 0.5, 18), 180));
    camera.lookAt(0, 0, 0);
}

function clearMap() {
    objects.forEach(obj => scene.remove(obj));
    objects = [];
    selectedObject = null;
    updateTeleportSettingsVisibility();
}

function clampInteger(value, min, max, fallback) {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(numeric, min), max);
}

function createDungeonSettingField(form, labelText, value, min, max) {
    const row = document.createElement('label');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr 90px';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.margin = '10px 0';
    row.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.style.width = '90px';
    row.appendChild(input);
    form.appendChild(row);
    return input;
}

function createDungeonMapSelectField(form, labelText, selectedValue) {
    const row = document.createElement('label');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr 120px';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.margin = '10px 0';
    row.textContent = labelText;

    const select = document.createElement('select');
    select.style.width = '120px';
    const options = getMapOptions();
    const fallbackValue = selectedValue || getDefaultTeleportTarget();
    let hasValue = false;
    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
        if (option.value === fallbackValue) {
            hasValue = true;
        }
    });
    if (fallbackValue && !hasValue) {
        const opt = document.createElement('option');
        opt.value = fallbackValue;
        opt.textContent = formatMapLabel(fallbackValue);
        select.appendChild(opt);
    }
    select.value = fallbackValue;
    row.appendChild(select);
    form.appendChild(row);
    return select;
}

function showDungeonSettingsPopup() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.55)';
    overlay.style.zIndex = '3000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const panel = document.createElement('div');
    panel.style.width = '300px';
    panel.style.background = '#2f2f2f';
    panel.style.color = '#fff';
    panel.style.border = '1px solid #777';
    panel.style.padding = '18px';
    panel.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    overlay.appendChild(panel);

    const title = document.createElement('h3');
    title.textContent = 'Dungeon Settings';
    title.style.margin = '0 0 12px';
    panel.appendChild(title);

    const form = document.createElement('form');
    panel.appendChild(form);

    const sizeInput = createDungeonSettingField(form, 'Map Size', DEFAULT_DUNGEON_SETTINGS.mapSize, 24, 180);
    const zombieInput = createDungeonSettingField(form, 'Zombies Count', DEFAULT_DUNGEON_SETTINGS.zombieCount, 0, 500);
    const roomsInput = createDungeonSettingField(form, 'Rooms', DEFAULT_DUNGEON_SETTINGS.rooms, 1, 300);
    const teleportTargetSelect = createDungeonMapSelectField(form, 'Teleport Room', getDefaultTeleportTarget());

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.justifyContent = 'flex-end';
    actions.style.marginTop = '16px';
    form.appendChild(actions);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'button';
    cancelButton.style.margin = '0';
    actions.appendChild(cancelButton);

    const generateButton = document.createElement('button');
    generateButton.type = 'submit';
    generateButton.textContent = 'Generate';
    generateButton.className = 'button';
    generateButton.style.margin = '0';
    actions.appendChild(generateButton);

    function closePopup() {
        overlay.remove();
    }

    cancelButton.addEventListener('click', closePopup);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closePopup();
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const settings = {
            mapSize: clampInteger(sizeInput.value, 24, 180, DEFAULT_DUNGEON_SETTINGS.mapSize),
            zombieCount: clampInteger(zombieInput.value, 0, 500, DEFAULT_DUNGEON_SETTINGS.zombieCount),
            rooms: clampInteger(roomsInput.value, 1, 300, DEFAULT_DUNGEON_SETTINGS.rooms),
            teleportTargetMap: teleportTargetSelect.value || DEFAULT_DUNGEON_SETTINGS.teleportTargetMap
        };
        closePopup();
        generateDungeon(settings);
    });

    document.body.appendChild(overlay);
    sizeInput.focus();
    sizeInput.select();
}

function generateLandscape() {
    const size = 32;
    const half = Math.floor(size / 2);
    const data = [];

    for (let x = -half; x < half; x++) {
        for (let z = -half; z < half; z++) {
            const lake = Math.hypot(x + 12, z - 8) < 7 || Math.hypot(x - 16, z + 14) < 5;
            const river = Math.abs(z - Math.sin(x * 0.18) * 8) < 1.2;
            const hill = !lake && !river && (
                Math.hypot(x - 10, z - 12) < 6 ||
                Math.hypot(x + 18, z + 10) < 5 ||
                Math.hypot(x, z + 22) < 4
            );

            let type = 'terrain';
            if (lake || river) {
                type = 'water';
            } else if (hill) {
                type = 'hill';
            }

            data.push({
                position: [x, 0.5, z],
                rotation: 0,
                type
            });
        }
    }

    data.forEach(entry => addSelectedObjectFromData(entry));
    fitCameraToMap();
    alert('Landscape generated!');
}

function createDungeonLayout(width, height, roomCount, minRoomSize, maxRoomSize) {
    const grid = Array.from({ length: height }, () => Array(width).fill('empty'));
    const rooms = [];

    function carveRoom(room) {
        for (let z = room.z; z < room.z + room.h; z++) {
            for (let x = room.x; x < room.x + room.w; x++) {
                grid[z][x] = 'floor';
            }
        }
    }

    function carveCorridor(x1, z1, x2, z2) {
        let x = x1;
        let z = z1;
        while (x !== x2) {
            grid[z][x] = 'floor';
            x += x < x2 ? 1 : -1;
        }
        while (z !== z2) {
            grid[z][x] = 'floor';
            z += z < z2 ? 1 : -1;
        }
        grid[z][x] = 'floor';
    }

    for (let i = 0; i < roomCount; i++) {
        const w = minRoomSize + Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1));
        const h = minRoomSize + Math.floor(Math.random() * (maxRoomSize - minRoomSize + 1));
        const x = 1 + Math.floor(Math.random() * Math.max(1, width - w - 2));
        const z = 1 + Math.floor(Math.random() * Math.max(1, height - h - 2));
        const room = { x, z, w, h };
        const overlaps = rooms.some(other =>
            x < other.x + other.w + 2 &&
            x + w + 2 > other.x &&
            z < other.z + other.h + 2 &&
            z + h + 2 > other.z
        );
        if (overlaps) continue;

        carveRoom(room);
        const previous = rooms[rooms.length - 1];
        rooms.push(room);

        if (previous) {
            const ax = Math.floor(previous.x + previous.w / 2);
            const az = Math.floor(previous.z + previous.h / 2);
            const bx = Math.floor(room.x + room.w / 2);
            const bz = Math.floor(room.z + room.h / 2);
            if (Math.random() < 0.5) {
                carveCorridor(ax, az, bx, az);
                carveCorridor(bx, az, bx, bz);
            } else {
                carveCorridor(ax, az, ax, bz);
                carveCorridor(ax, bz, bx, bz);
            }
        }
    }

    return { grid, rooms };
}

function getDungeonZombieTypes() {
    return Object.values(allObjectData)
        .filter(obj => obj && (obj.ai === true || obj.isZombie === true))
        .map(obj => obj.id)
        .filter(Boolean);
}

function isCellInsideRoom(cell, room) {
    if (!cell || !room) return false;
    return cell.gridX >= room.x &&
        cell.gridX < room.x + room.w &&
        cell.gridZ >= room.z &&
        cell.gridZ < room.z + room.h;
}

function addDungeonZombies(result, floorCells, zombieCount, safeRoom = null) {
    const zombieTypes = getDungeonZombieTypes();
    if (!zombieTypes.length || zombieCount <= 0 || !floorCells.length) return;
    const cells = floorCells.filter(cell => !isCellInsideRoom(cell, safeRoom));
    for (let i = cells.length - 1; i > 0; i--) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[swapIndex]] = [cells[swapIndex], cells[i]];
    }

    const count = Math.min(zombieCount, cells.length);
    for (let i = 0; i < count; i++) {
        const cell = cells[i];
        const type = zombieTypes[Math.floor(Math.random() * zombieTypes.length)];
        result.push({
            position: [cell.x, 0.5, cell.z],
            rotation: Math.random() * Math.PI * 2,
            type
        });
    }
}

function addDungeonTeleportRoom(result, room, teleportTargetMap, offsetX, offsetZ) {
    if (!room || !teleportTargetMap) return;
    const x = Math.floor(room.x + room.w / 2) - offsetX;
    const z = Math.floor(room.z + room.h / 2) - offsetZ;
    result.push({
        position: [x, 0.5, z],
        rotation: 0,
        type: '3d car',
        teleport: {
            targetMap: teleportTargetMap
        }
    });
}

function dungeonGridToObjects(grid, options = {}) {
    const result = [];
    const floorCells = [];
    const height = grid.length;
    const width = grid[0] ? grid[0].length : 0;
    const offsetX = Math.floor(width / 2);
    const offsetZ = Math.floor(height / 2);
    const zombieCount = clampInteger(options.zombieCount, 0, 500, 0);
    const safeRoom = options.safeRoom || null;
    const teleportTargetMap = options.teleportTargetMap || null;

    function hasFloorNeighbor(x, z) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0) continue;
                if (grid[z + dz]?.[x + dx] === 'floor') {
                    return true;
                }
            }
        }
        return false;
    }

    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            const type = grid[z][x] === 'floor'
                ? 'terrain'
                : (hasFloorNeighbor(x, z) ? 'wall' : null);
            if (!type) continue;
            result.push({
                position: [x - offsetX, 0.5, z - offsetZ],
                rotation: 0,
                type
            });
            if (type === 'terrain') {
                floorCells.push({
                    x: x - offsetX,
                    z: z - offsetZ,
                    gridX: x,
                    gridZ: z
                });
            }
        }
    }

    addDungeonTeleportRoom(result, safeRoom, teleportTargetMap, offsetX, offsetZ);
    addDungeonZombies(result, floorCells, zombieCount, safeRoom);
    return result;
}

function generateDungeon(settings = DEFAULT_DUNGEON_SETTINGS) {
    const mapSize = clampInteger(settings.mapSize, 24, 180, DEFAULT_DUNGEON_SETTINGS.mapSize);
    const zombieCount = clampInteger(settings.zombieCount, 0, 500, DEFAULT_DUNGEON_SETTINGS.zombieCount);
    const rooms = clampInteger(settings.rooms, 1, 300, DEFAULT_DUNGEON_SETTINGS.rooms);
    const teleportTargetMap = isValidMapPath(settings.teleportTargetMap)
        ? settings.teleportTargetMap
        : getDefaultTeleportTarget();
    const minRoomSize = Math.max(4, Math.floor(mapSize / 18));
    const maxRoomSize = Math.max(minRoomSize + 2, Math.floor(mapSize / 6));
    const layout = createDungeonLayout(mapSize, mapSize, rooms, minRoomSize, maxRoomSize);
    const safeRoom = layout.rooms[0] || null;
    const dungeonObjects = dungeonGridToObjects(layout.grid, {
        zombieCount,
        safeRoom,
        teleportTargetMap
    });

    clearMap();

    dungeonObjects.forEach(obj => {
        addSelectedObjectFromData(obj);
    });

    fitCameraToMap();
    alert(`Dungeon generated: ${dungeonObjects.length} objects`);
}

// Make button/HTML-called functions available globally:
window.saveMap = saveMap;
window.loadMap = loadMap;
window.loadSelectedMap = loadSelectedMap;
window.addSelectedObject = addSelectedObject;
window.removeObject = removeObject;
window.updateSelectedObject = updateSelectedObject;

// Load ALL objects and start animating!
loadMapList();
loadAllTypes();
animate();
function animate() {
    requestAnimationFrame(animate);
    updateMovement();
    renderer.render(scene, camera);
}

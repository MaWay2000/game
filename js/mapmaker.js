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
    generateDungeon();
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

// Load ALL object types at startup
function loadAllTypes() {
    fetch('objects.json')
        .then(res => res.json())
        .then(objects => {
            objectTypeList = ['objects'];
            objectDataByType.objects = objects;
            objects.forEach(obj => {
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
        opt.textContent = obj.name || obj.id;
        objectSelect.appendChild(opt);
    });
    if (objList.length > 0) {
        objectSelect.value = objList[0].id;
        currentType = type;
        currentObjectId = objList[0].id;
        prepareObject(objList[0]);
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
    }
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
        item.userData.type = entry.type;
        scene.add(item);
        objects.push(item);
    } else if (obj && allGeometries[obj.id] && allMaterials[obj.id]) {
        const mat = allMaterials[obj.id].clone();
        mat.opacity = 1;
        mat.transparent = false;
        item = new THREE.Mesh(allGeometries[obj.id], mat);
        item.position.fromArray(entry.position);
        item.rotation.y = entry.rotation || 0;
        item.userData.type = entry.type;
        scene.add(item);
        objects.push(item);
    } else {
        console.warn(`Unknown object type: ${entry.type}`);
        return;
    }
}

function addSelectedObject() {
    if (!tempItem) return;
    addSelectedObjectFromData({
        position: tempItem.position.toArray(),
        rotation: currentRotation,
        type: currentObjectId
    });
}

function removeObject() {
    if (selectedObject) {
        scene.remove(selectedObject);
        objects = objects.filter(o => o !== selectedObject);
        selectedObject = null;
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
    const mapData = objects.map(obj => ({
        position: obj.position.toArray(),
        rotation: obj.rotation.y,
        type: obj.userData.type || 'unknown'
    }));

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
}

function generateLandscape() {
    fetch('landshaft_generator.php', {
        method: 'POST',
        body: JSON.stringify({
            map_size: 100,
            hill_density: 0.5,
            hill_height: 3,
            lake_count: 4,
            river_count: 1
        }),
        headers: { 'Content-Type': 'application/json' },
    })
    .then(res => res.json())
    .then(data => {
        data.forEach(entry => addSelectedObjectFromData(entry));
        alert('Landscape generated!');
    })
    .catch(err => alert('Landscape generation failed: ' + err));
}

function generateDungeon() {
    const { grid, rooms } = generateDungeonGrid(200, 200, 1000, 4, 20);
    const dungeonObjects = dungeonToObjects(grid, rooms);

    clearMap();

    dungeonObjects.forEach(obj => {
        addSelectedObjectFromData(obj);
    });

    alert('Dungeon generated!');
}

// Make button/HTML-called functions available globally:
window.saveMap = saveMap;
window.loadMap = loadMap;
window.loadSelectedMap = loadSelectedMap;
window.addSelectedObject = addSelectedObject;
window.removeObject = removeObject;
window.updateSelectedObject = updateSelectedObject;

// Load ALL objects and start animating!
loadAllTypes();
animate();
function animate() {
    requestAnimationFrame(animate);
    updateMovement();
    renderer.render(scene, camera);
}

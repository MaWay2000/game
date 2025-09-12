// mapLoader.js

let loadedObjects = [];
let visibleObjects = [];
let objectRules = {};
let geometries = {};
let materials = {};
let textures = {};
let gltfModels = {};
let gltfAnimations = {};
let gltfLoadedFlags = {};

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new THREE.GLTFLoader();

function loadGLTFModel(id, modelPath) {
    return new Promise((resolve, reject) => {
        if (gltfModels[id]) return resolve();
        gltfLoader.load(
            modelPath,
            gltf => {
                gltfModels[id] = gltf.scene;
                gltfAnimations[id] = gltf.animations || [];
                gltfLoadedFlags[id] = true;
                resolve();
            },
            undefined,
            err => {
                console.warn(`Failed to load GLTF for ${id}: ${modelPath}`, err);
                gltfLoadedFlags[id] = false;
                resolve();
            }
        );
    });
}

export async function loadMap(scene) {
    // GitHub Pages and other static hosts cannot execute PHP files.
    // Instead of requesting "mapmaker.php" to list available JSON files,
    // we directly reference the JSON sources used by the game.
    const jsonFiles = ['objects', 'zombies'];

    objectRules = {};
    geometries = {};
    materials = {};
    textures = {};
    gltfModels = {};
    gltfAnimations = {};
    gltfLoadedFlags = {};

    let allDefinitions = [];
    let gltfPromises = [];
    for (let file of jsonFiles) {
        if (file === 'saved_map') continue;
        const res = await fetch(`${file}.json`);
        if (!res.ok) continue;
        try {
            const arr = await res.json();
            allDefinitions = allDefinitions.concat(arr);
        } catch (e) {
            console.warn(`Invalid JSON in ${file}.json`, e);
        }
    }

    for (const obj of allDefinitions) {
        objectRules[obj.id] = {
            collidable: obj.collidable === true,
            model: obj.model || null,
            ai: obj.ai === true || obj.isZombie === true, // extra fallback
            geometry: obj.size ? obj.size.slice() : [1,1,1],
            color: obj.color || '#999999',
            texture: obj.texture || null
        };
        if (!obj.model) {
            if (!geometries[obj.id] && obj.size) {
                geometries[obj.id] = new THREE.BoxGeometry(...obj.size);
            }
            if (!materials[obj.id]) {
                if (obj.texture) {
                    if (!textures[obj.texture]) {
                        textures[obj.texture] = textureLoader.load(obj.texture);
                    }
                    materials[obj.id] = new THREE.MeshLambertMaterial({
                        map: textures[obj.texture],
                        color: obj.color || '#999999'
                    });
                } else {
                    materials[obj.id] = new THREE.MeshLambertMaterial({
                        color: obj.color || '#999999',
                        opacity: 1,
                        transparent: false
                    });
                }
            }
        } else if (obj.model) {
            gltfLoadedFlags[obj.id] = false;
            gltfPromises.push(loadGLTFModel(obj.id, obj.model));
        }
    }

    await Promise.all(gltfPromises);

    // The map data is stored in a static JSON file when served from GitHub Pages.
    const resMap = await fetch('saved_map.json');
    if (!resMap.ok) {
        console.error('Failed to fetch map data.');
        return [];
    }
    let mapData;
    try {
        mapData = await resMap.json();
    } catch (e) {
        console.error('Invalid JSON from saved_map.json', e);
        return [];
    }

    loadedObjects = [];

    for (const item of mapData) {
        const { position, type, rotation = 0 } = item;
        if (type === 'hill') continue;
        const rule = objectRules[type];
        let mesh = null;

        // ---- NEW: Always allow zombies and model objects! ----
        if (rule && rule.model && gltfModels[type]) {
            const sourceModel = gltfModels[type];
            if (THREE.SkeletonUtils && THREE.SkeletonUtils.clone) {
                mesh = THREE.SkeletonUtils.clone(sourceModel);
            } else {
                mesh = sourceModel.clone(true);
            }
            mesh.traverse(node => {
                if (node.isMesh) {
                    node.material = node.material.clone();
                    node.material.opacity = 1;
                    node.material.transparent = false;
                }
            });
            if (rule.geometry) {
                const box = new THREE.Box3().setFromObject(mesh);
                const size = new THREE.Vector3();
                box.getSize(size);
                if (size.x > 0 && size.y > 0 && size.z > 0) {
                    mesh.scale.set(
                        rule.geometry[0] / size.x,
                        rule.geometry[1] / size.y,
                        rule.geometry[2] / size.z
                    );
                }
            }
            if (gltfAnimations[type] && gltfAnimations[type].length > 0) {
                const mixer = new THREE.AnimationMixer(mesh);
                gltfAnimations[type].forEach(clip => {
                    const action = mixer.clipAction(clip);
                    action.play();
                });
                mesh.userData.mixer = mixer;
            }
            mesh.position.fromArray(position);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            if (rule.ai) mesh.userData.ai = true;
            loadedObjects.push(mesh);
        } else if (rule && (rule.ai || item.ai || item.isZombie)) {
            // If missing model, fallback to box for zombie
            let geo = geometries[type] || new THREE.BoxGeometry(...(rule.geometry || [1,1,1]));
            let mat = materials[type] || new THREE.MeshLambertMaterial({ color: rule.color || 0x44ff44 });
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.fromArray(position);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule, ai: true };
            loadedObjects.push(mesh);
        } else if (rule && geometries[type] && materials[type]) {
            mesh = new THREE.Mesh(geometries[type], materials[type]);
            mesh.position.fromArray(position);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            loadedObjects.push(mesh);
        } else if (rule && rule.geometry) {
            // Final fallback for unknown object with geometry (render as colored box)
            const geo = new THREE.BoxGeometry(...rule.geometry);
            let mat;
            if (rule.texture) {
                if (!textures[rule.texture]) {
                    textures[rule.texture] = textureLoader.load(rule.texture);
                }
                mat = new THREE.MeshLambertMaterial({
                    map: textures[rule.texture],
                    color: rule.color
                });
            } else {
                mat = new THREE.MeshLambertMaterial({ color: rule.color, opacity: 1 });
            }
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.fromArray(position);
            mesh.rotation.y = rotation;
            mesh.userData = { ...item, rules: rule };
            loadedObjects.push(mesh);
        } else {
            console.warn(`Unknown object type: ${type}`, item);
        }
    }

    updateVisibleObjects(scene, 0, 0, 40);
    scene.fog = new THREE.Fog(0x000000, 2, 15);
    return loadedObjects;
}

export function getLoadedObjects() {
    return visibleObjects;
}

export function updateVisibleObjects(scene, playerX, playerZ, viewDist) {
    visibleObjects.forEach(obj => scene.remove(obj));
    visibleObjects = [];
    loadedObjects.forEach(obj => {
        const dx = obj.position.x - playerX;
        const dz = obj.position.z - playerZ;
        if ((dx * dx + dz * dz) < viewDist * viewDist) {
            scene.add(obj);
            visibleObjects.push(obj);
        }
    });
}

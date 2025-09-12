import { setupCamera, enablePointerLock } from './camera.js';
import { loadMap, updateVisibleObjects, getLoadedObjects } from './mapLoader.js';
import { setupMovement } from './movement.js';
import { checkPickups } from './pickup.js';
import { initHUD, updateHUD } from './hud.js';
import { addPistolToCamera, shootPistol, updateBullets } from './pistol.js';
import { initCrosshair, drawCrosshair, positionCrosshair } from './crosshair.js';
import { setupZoom } from './zoom.js';
import { spawnZombiesFromMap, updateZombies, getZombies } from './zombie.js';

// --- Scene and Camera setup ---
const scene = new THREE.Scene();
const { camera, cameraContainer } = setupCamera();
scene.add(cameraContainer);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

function spawnSplash() {
  const splash = document.createElement('div');
  splash.className = 'splash';
  splash.style.left = `${Math.random() * 80 + 10}%`;
  splash.style.top = `${Math.random() * 80 + 10}%`;
  document.body.appendChild(splash);
  setTimeout(() => splash.remove(), 500);
}

let shakeTime = 0;
function triggerShake() {
  shakeTime = 0.3;
}

function applyShake(delta) {
  if (shakeTime > 0) {
    const intensity = 5;
    const dx = (Math.random() * 2 - 1) * intensity;
    const dy = (Math.random() * 2 - 1) * intensity;
    canvas.style.transform = `translate(${dx}px, ${dy}px)`;
    shakeTime -= delta;
  } else {
    canvas.style.transform = '';
  }
}

function handlePlayerHit() {
  movement.setEnabled(false);
  setTimeout(() => movement.setEnabled(true), 500);
  spawnSplash();
  triggerShake();
}

// ---- Torch (SpotLight) setup ----
const TORCH_COLOR = 0xffe5a0;
const TORCH_INTENSITY = 2.7;
const TORCH_DISTANCE = 18;
const TORCH_ANGLE = THREE.MathUtils.degToRad(36);
const TORCH_PENUMBRA = 0.95;
const TORCH_DECAY = 1.5;

const torch = new THREE.SpotLight(
    TORCH_COLOR,
    TORCH_INTENSITY,
    TORCH_DISTANCE,
    TORCH_ANGLE,
    TORCH_PENUMBRA,
    TORCH_DECAY
);
torch.position.set(0, 0.5, 0); // Above player's eyes
camera.add(torch);
scene.add(torch.target);

scene.add(new THREE.AmbientLight(0x000000)); // Only what torch sees is visible
scene.fog = null;

// --- Geometry & Materials (with texture support) ---
const geometries = {};
const materials = {};
const textureLoader = new THREE.TextureLoader();
const PLAYER_VIEW_DISTANCE = 18;

// Track models for zombies/objects
const models = {};

// --- Only call spawnZombiesFromMap ONCE after map loads ---
let zombiesSpawned = false;

fetch('objects.json')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(async objects => {
    // Load geometries/materials/models
    for (const obj of objects) {
      const size = obj.size || [1, 1, 1];
      geometries[obj.id] = new THREE.BoxGeometry(...size);

      if (obj.texture) {
        const mat = new THREE.MeshLambertMaterial({
          map: textureLoader.load(obj.texture, tex => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          })
        });
        materials[obj.id] = mat;
      } else {
        materials[obj.id] = new THREE.MeshLambertMaterial({
          color: obj.color || '#999999'
        });
      }
      // Optional: load GLTF models if needed for zombies/objects
      if (obj.model && window.THREE.GLTFLoader) {
        const loader = new THREE.GLTFLoader();
        await new Promise(resolve => {
          loader.load(obj.model, gltf => {
            models[obj.id] = gltf.scene;
            resolve();
          }, undefined, () => resolve());
        });
      }
    }

    // Load map and spawn zombies once!
    loadMap(scene, geometries, materials).then(mapObjects => {
      if (!zombiesSpawned) {
        spawnZombiesFromMap(scene, mapObjects, models, materials);
        zombiesSpawned = true;
      }
    });
  })
  .catch(err => {
    console.error('Error loading objects.json:', err);
    alert('Failed to load object definitions.');
  });

// --- Controls, HUD, Movement, etc ---
const movement = setupMovement(cameraContainer, camera, scene);
initHUD();
updateHUD(10, 100);
initCrosshair();
enablePointerLock(renderer, cameraContainer, camera);
setupZoom(camera);
addPistolToCamera(camera);

document.addEventListener('mousedown', (e) => {
  if (e.button === 0) shootPistol(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  positionCrosshair();
});

// --- Chunk-based culling/performance ---
let lastChunkX = null, lastChunkZ = null;
const UPDATE_CHUNK_SIZE = 5;

// --- Torch direction logic ---
function updateTorchTarget(camera, torch) {
    const worldPos = new THREE.Vector3();
    camera.getWorldPosition(worldPos);
    const worldDir = new THREE.Vector3();
    camera.getWorldDirection(worldDir);
    torch.target.position.copy(worldPos.clone().add(worldDir.multiplyScalar(10)));
    if (torch.target.parent !== scene) scene.add(torch.target);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  movement.update();
  applyShake(delta);

  // Chunk logic (this does not affect zombies)
  const playerX = Math.round(cameraContainer.position.x / UPDATE_CHUNK_SIZE) * UPDATE_CHUNK_SIZE;
  const playerZ = Math.round(cameraContainer.position.z / UPDATE_CHUNK_SIZE) * UPDATE_CHUNK_SIZE;
  if (playerX !== lastChunkX || playerZ !== lastChunkZ) {
    updateVisibleObjects(scene, cameraContainer.position.x, cameraContainer.position.z, PLAYER_VIEW_DISTANCE);
    lastChunkX = playerX;
    lastChunkZ = playerZ;
  }

  updateTorchTarget(camera, torch);

  // ---- ZOMBIE AI update ----
  const playerPos = cameraContainer.position;
  updateZombies(playerPos, delta, getLoadedObjects(), handlePlayerHit);

  checkPickups(cameraContainer, scene);
  updateBullets(delta);

  renderer.render(scene, camera);
  drawCrosshair();
}

window.onload = () => {
  positionCrosshair();
  animate();
};

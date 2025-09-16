import { setupCamera, enablePointerLock } from './camera.js';
import { loadMap, updateVisibleObjects, getLoadedObjects } from './mapLoader.js';
import { setupMovement } from './movement.js';
import { checkPickups } from './pickup.js';
import { initHUD, updateHUD } from './hud.js';
import { initMinimap, updateMinimap, toggleFullMap } from './minimap.js';
import { addPistolToCamera, shootPistol, updateBullets } from './pistol.js';
import { initCrosshair, drawCrosshair, positionCrosshair } from './crosshair.js';
import { setupZoom } from './zoom.js';
import { spawnZombiesFromMap, updateZombies, updateBloodEffects } from './zombie.js';

// --- Scene and Camera setup ---
const scene = new THREE.Scene();
const { camera, cameraContainer } = setupCamera();
scene.add(cameraContainer);

// Secondary camera dedicated to first-person weapon rendering
const weaponCamera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);
weaponCamera.layers.set(1);
camera.add(weaponCamera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// Audio for player getting hit
const hitSound = new Audio('sounds/gethit.mp3');

function spawnSplash() {
  const splash = document.createElement('div');
  splash.className = 'splash';
  splash.style.left = `${Math.random() * 80 + 10}%`;
  splash.style.top = `${Math.random() * 80 + 10}%`;
  document.body.appendChild(splash);
  setTimeout(() => splash.remove(), 500);
}

// Flash effect when a zombie is killed
function spawnKillFlash() {
  const flash = document.createElement('div');
  flash.className = 'splash';
  flash.style.left = '50%';
  flash.style.top = '50%';
  flash.style.marginLeft = '-25px';
  flash.style.marginTop = '-25px';
  flash.style.background = 'rgba(255,255,255,0.5)';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 300);
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

// Current knockback velocity applied each frame
let knockbackVelocity = new THREE.Vector3();

// Smoothly move the player according to knockback velocity
function applyKnockback(delta) {
  if (knockbackVelocity.lengthSq() === 0) return;

  // Proposed new position after applying knockback this frame
  const displacement = knockbackVelocity.clone().multiplyScalar(delta);
  const target = cameraContainer.position.clone().add(displacement);

  // Stop knockback if we'd collide with the world
  if (movement.checkCollision && movement.checkCollision(target)) {
    knockbackVelocity.set(0, 0, 0);
    return;
  }

  // Move player
  cameraContainer.position.copy(target);

  // Gradually reduce velocity so knockback tapers off
  const DAMPING = 5; // higher = quicker slowdown
  knockbackVelocity.multiplyScalar(Math.max(1 - DAMPING * delta, 0));
  if (knockbackVelocity.lengthSq() < 0.0001) {
    knockbackVelocity.set(0, 0, 0);
  }
}

function handlePlayerHit(dir) {
  hitSound.currentTime = 0;
  hitSound.play();
  if (dir) {
    const strength = 5; // initial knockback speed
    knockbackVelocity.copy(dir).multiplyScalar(strength);
  }
  movement.setEnabled(false);
  setTimeout(() => movement.setEnabled(true), 500);
  spawnSplash();
  triggerShake();
}

// ---- Torch (SpotLight) setup ----
const TORCH_COLOR = 0xffe5a0;
const TORCH_INTENSITY = 13.5;
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
// Offset slightly forward so walls remain lit when the player is up close
torch.position.set(0, 0.5, -0.2); // Above player's eyes
camera.add(torch);
torch.layers.enable(1);
scene.add(torch.target);

// Secondary bright spotlight that can flood the area with light
const GODS_SUN_COLOR = 0xffffff;
const GODS_SUN_INTENSITY = 100;
const GODS_SUN_DISTANCE = 100;
const GODS_SUN_ANGLE = Math.PI / 2; // Wide cone
const godsSun = new THREE.SpotLight(
    GODS_SUN_COLOR,
    GODS_SUN_INTENSITY,
    GODS_SUN_DISTANCE,
    GODS_SUN_ANGLE
);
godsSun.visible = false;
camera.add(godsSun);
godsSun.layers.enable(1);
scene.add(godsSun.target);

scene.add(new THREE.AmbientLight(0x000000)); // Only what torch sees is visible
scene.fog = null;

// --- Geometry & Materials (with texture support) ---
const geometries = {};
const materials = {};
const textureLoader = new THREE.TextureLoader();
// Increased to ensure zombies remain within loaded map bounds
const PLAYER_VIEW_DISTANCE = 25;

// Track models for zombies/objects
const models = {};

// --- Only call spawnZombiesFromMap ONCE after map loads ---
let zombiesSpawned = false;

Promise.all([
  fetch('objects.json').then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).catch(() => []),
  fetch('zombies.json').then(res => res.ok ? res.json() : []).catch(() => [])
]).then(async ([objects, zombies]) => {
    const allDefs = [...objects, ...zombies];

    // Load geometries/materials/models
    for (const obj of allDefs) {
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
          loader.load(
            obj.model,
            gltf => {
              models[obj.id] = {
                scene: gltf.scene,
                animations: gltf.animations || []
              };
              const clipNames = (gltf.animations || []).map(c => c.name);
              if (clipNames.length) {
                console.log(`Loaded model ${obj.model} for ${obj.id} with clips: ${clipNames.join(', ')}`);
              } else {
                console.log(`Loaded model ${obj.model} for ${obj.id} with no animation clips`);
              }
              resolve();
            },
            undefined,
            err => {
              console.warn(`Failed to load model ${obj.model} for ${obj.id}`, err);
              resolve();
            }
          );
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
    console.error('Error loading object/zombie definitions:', err);
    alert('Failed to load object or zombie definitions.');
  });

// --- Controls, HUD, Movement, etc ---
const movement = setupMovement(cameraContainer, camera, scene);
initHUD();
updateHUD(10, 100);
initCrosshair();
enablePointerLock(renderer, cameraContainer, camera);
setupZoom(camera, weaponCamera);
addPistolToCamera(weaponCamera);
initMinimap();

document.addEventListener('mousedown', (e) => {
  if (e.button === 0) shootPistol(scene, camera);
});

// Toggle "Gods sun" spotlight with the L key
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL') {
    godsSun.visible = !godsSun.visible;
    torch.visible = !godsSun.visible;
  }
  if (e.code === 'KeyM') {
    toggleFullMap(cameraContainer, camera);
  }
});

// React to zombie deaths with a flash and screen shake
window.addEventListener('zombieKilled', () => {
  spawnKillFlash();
  triggerShake();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();
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
  applyKnockback(delta);
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
  updateTorchTarget(camera, godsSun);

  // ---- Zombie animation & AI update ----
  updateZombies(delta, cameraContainer, handlePlayerHit, movement.getState());
  updateBloodEffects(delta);

  checkPickups(cameraContainer, scene);
  updateBullets(delta);
  updateMinimap(cameraContainer, camera, getLoadedObjects());

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(scene, weaponCamera);
  drawCrosshair(delta);
}

window.onload = () => {
  positionCrosshair();
  animate();
};

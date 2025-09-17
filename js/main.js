import { setupCamera, enablePointerLock } from './camera.js';
import {
  loadMap,
  updateVisibleObjects,
  getLoadedObjects,
  getWalkablePositions,
  registerLoadingManager as registerMapLoadingManager,
  removeObjectBySaveKey
} from './mapLoader.js';
import { setupMovement } from './movement.js';
import { checkPickups } from './pickup.js';
import { initHUD, updateHUD, setHUDVisible, updateKillCount, toggleStatsVisibility, updateCoinCount } from './hud.js';
import { initMinimap, updateMinimap, toggleFullMap, setMinimapEnabled, setMinimapMapSource } from './minimap.js';
import { addPistolToCamera, shootPistol, updateBullets, setPistolEnabled, getPistolState, setPistolState } from './pistol.js';
import { initCrosshair, drawCrosshair, positionCrosshair, setCrosshairVisible } from './crosshair.js';
import { updateDoors } from './doors.js';
import { setupZoom } from './zoom.js';
import { spawnZombiesFromMap, spawnRandomZombies, updateZombies, updateBloodEffects, initZombieSettingsUI, registerLoadingManager as registerZombieLoadingManager, clearZombies } from './zombie.js';
import { setupTorch, updateTorchTarget, updateTorchFlicker } from './torch.js';
import { readSaveData, writeSaveData, clearSaveData } from './saveSystem.js';

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

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
const QUICK_SAVE_DELAY_MS = 2000;
const HOME_MAP_PATH = 'maps/home.json';
const DUNGEON_MAP_PATH = 'saved_map.json';
const DEFAULT_MAP_PATH = HOME_MAP_PATH;
const MAP_RANDOM_ZOMBIES_DISABLED = new Set([HOME_MAP_PATH]);
const CAR_INTERACT_DISTANCE = 2.5;
const CAR_INTERACT_DISTANCE_SQ = CAR_INTERACT_DISTANCE * CAR_INTERACT_DISTANCE;
const MAP_TRANSITIONS = {
  [HOME_MAP_PATH]: {
    targetMap: DUNGEON_MAP_PATH,
    spawn: {
      position: { x: 4, y: 0, z: 2 },
      rotation: Math.PI
    }
  },
  [DUNGEON_MAP_PATH]: {
    targetMap: HOME_MAP_PATH,
    spawn: {
      position: { x: 0, y: 0, z: 3 },
      rotation: Math.PI
    }
  }
};

const HOME_DEFAULT_SPAWN = MAP_TRANSITIONS[DUNGEON_MAP_PATH]?.spawn || {
  position: { x: 0, y: 0, z: 3 },
  rotation: Math.PI
};

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

function getInitialQueryString() {
  if (typeof window === 'undefined') {
    return '';
  }
  if (typeof window.__INITIAL_QUERY_STRING__ === 'string') {
    return window.__INITIAL_QUERY_STRING__;
  }
  return window.location.search || '';
}

function getMapPathFromQuery() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(getInitialQueryString());
    return params.get('map');
  } catch (err) {
    console.warn('Unable to read map from URL:', err);
    return null;
  }
}

function getMapPathFromHistoryState() {
  if (typeof window === 'undefined' || !window.history) {
    return null;
  }
  try {
    const state = window.history.state;
    const mapPath = state?.mapPath ?? state?.map;
    return typeof mapPath === 'string' ? mapPath : null;
  } catch (err) {
    console.warn('Unable to read map from history state:', err);
    return null;
  }
}

function sanitizeRemovedKeyArray(keys) {
  if (!Array.isArray(keys)) {
    return [];
  }
  const result = [];
  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string' || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
}

function updateURLForCurrentMap() {
  if (typeof window === 'undefined' || !window.history || !window.location) {
    return;
  }
  try {
    const url = new URL(window.location.href);
    url.search = '';
    const state = { ...(window.history.state || {}) };
    state.mapPath = currentMapPath;
    window.history.replaceState(state, '', url);
  } catch (err) {
    console.warn('Unable to update map URL:', err);
  }
}

function applyDefaultSpawnForCurrentMap() {
  if (!cameraContainer || !camera) {
    return;
  }
  if (canRestorePlayerToCurrentMap) {
    return;
  }
  if (currentMapPath !== HOME_MAP_PATH) {
    return;
  }

  const spawn = HOME_DEFAULT_SPAWN || {};
  const spawnPos = spawn.position || spawn.pos || null;
  if (spawnPos && typeof spawnPos === 'object') {
    const sx = Number(spawnPos.x ?? spawnPos[0]);
    const sy = Number(spawnPos.y ?? spawnPos[1]);
    const sz = Number(spawnPos.z ?? spawnPos[2]);
    cameraContainer.position.set(
      Number.isFinite(sx) ? sx : cameraContainer.position.x,
      Number.isFinite(sy) ? sy : cameraContainer.position.y,
      Number.isFinite(sz) ? sz : cameraContainer.position.z
    );
  } else {
    cameraContainer.position.set(0, 0, 0);
  }

  if (Number.isFinite(spawn.rotation)) {
    cameraContainer.rotation.y = spawn.rotation;
  }
  camera.rotation.x = 0;
}

const savedGameData = readSaveData() || null;
const savedWorldState = savedGameData?.world || null;
const savedMapFromSave = sanitizeMapPath(savedWorldState?.mapPath);
const queryMapPath = sanitizeMapPath(getMapPathFromQuery());
const historyMapPath = sanitizeMapPath(getMapPathFromHistoryState());
let currentMapPath = queryMapPath || historyMapPath || DEFAULT_MAP_PATH;
const canRestorePlayerToCurrentMap = Boolean(savedGameData?.player) && (!savedMapFromSave || savedMapFromSave === currentMapPath);

applyDefaultSpawnForCurrentMap();

const removalState = new Map();
if (savedWorldState?.removedObjectKeysByMap && typeof savedWorldState.removedObjectKeysByMap === 'object') {
  Object.entries(savedWorldState.removedObjectKeysByMap).forEach(([path, keys]) => {
    const sanitizedPath = sanitizeMapPath(path);
    if (!sanitizedPath) {
      return;
    }
    removalState.set(sanitizedPath, new Set(sanitizeRemovedKeyArray(keys)));
  });
}

if (!removalState.size && Array.isArray(savedWorldState?.removedObjectKeys)) {
  const legacyPath = savedMapFromSave || DEFAULT_MAP_PATH;
  removalState.set(legacyPath, new Set(sanitizeRemovedKeyArray(savedWorldState.removedObjectKeys)));
}

let removedObjectKeys = new Set(removalState.get(currentMapPath) || []);
updateURLForCurrentMap();

let autosaveIntervalId = null;
let pendingQuickSaveTimeout = null;
let canSaveProgress = false;
let appliedWorldMapPath = null;
let playerStateRestored = false;
let isTransitioningMap = false;

const canPointerLock = typeof canvas.requestPointerLock === 'function';
let isPointerLocked = !canPointerLock;

if (canPointerLock) {
  const updatePointerLockState = () => {
    isPointerLocked = document.pointerLockElement === canvas;
  };

  document.addEventListener('pointerlockchange', updatePointerLockState);
  document.addEventListener('pointerlockerror', () => {
    isPointerLocked = false;
  });
  updatePointerLockState();
}

const loadingOverlay = document.getElementById('loading-overlay');
const loadingBarProgress = document.getElementById('loading-bar-progress');
const loadingPercentage = document.getElementById('loading-percentage');
const loadingMessage = document.getElementById('loading-message');

const loadingManager = new THREE.LoadingManager();
registerMapLoadingManager(loadingManager);
registerZombieLoadingManager(loadingManager);

let loadingOverlayHidden = false;
let loadingManagerFinished = false;
let initializationFinished = false;
let initializationFailed = false;
let lastProgressLoaded = 0;
let lastProgressTotal = 0;

function formatLoadingLabel(value) {
  if (!value || typeof value !== 'string') {
    return 'assets';
  }
  let label = value;
  const queryIndex = label.indexOf('?');
  if (queryIndex !== -1) {
    label = label.slice(0, queryIndex);
  }
  const hashIndex = label.indexOf('#');
  if (hashIndex !== -1) {
    label = label.slice(0, hashIndex);
  }
  label = label.split(/[\\/]/).pop() || label;
  if (label.includes(':')) {
    label = label.split(':').pop() || label;
  }
  return label || 'assets';
}

function getFriendlyLoadingMessage(value) {
  const label = formatLoadingLabel(value);
  const normalized = label.toLowerCase();

  const extension = normalized.match(/\.([a-z0-9]+)$/i)?.[1] || '';

  if (/(setting|config|option)/.test(normalized)) {
    return 'Loading settings';
  }
  const isMapAsset =
    normalized.includes('saved_map') ||
    normalized.includes('mapmaker') ||
    /map\.json$/.test(normalized);
  if (isMapAsset) {
    return 'Loading map layout';
  }
  if (/zombie/.test(normalized) && normalized.includes('.json')) {
    return 'Loading zombie roster';
  }
  if (/object/.test(normalized) && normalized.includes('.json')) {
    return 'Loading world objects';
  }
  if (/(sound|audio)/.test(normalized) || /(mp3|wav|ogg|flac)$/.test(extension)) {
    return 'Loading audio';
  }
  if (/(glb|gltf|fbx)$/i.test(extension) || /model/.test(normalized)) {
    return 'Loading models';
  }
  if (/(png|jpg|jpeg|gif|bmp|webp|tga)$/i.test(extension) || /texture/.test(normalized)) {
    return 'Loading textures';
  }
  if (/(ttf|otf|woff|woff2)$/i.test(extension) || /font/.test(normalized)) {
    return 'Loading fonts';
  }
  if (/(shader|frag|vert)/.test(normalized)) {
    return 'Loading shaders';
  }

  return 'Loading assets';
}

function updateLoadingProgress(loaded, total) {
  if (typeof loaded !== 'number' || typeof total !== 'number') {
    return;
  }
  lastProgressLoaded = loaded;
  lastProgressTotal = total;
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(loaded / safeTotal, 0), 1);
  if (loadingBarProgress) {
    loadingBarProgress.style.transform = `scaleX(${ratio})`;
  }
  if (loadingPercentage) {
    loadingPercentage.textContent = `${Math.round(ratio * 100)}%`;
  }
}

function setLoadingMessage(text) {
  if (loadingMessage && typeof text === 'string') {
    loadingMessage.textContent = text;
  }
}

function setLoadingMessageFromLabel(value) {
  setLoadingMessage(`${getFriendlyLoadingMessage(value)}...`);
}

function setLoadingErrorMessage(value) {
  const friendly = getFriendlyLoadingMessage(value);
  const topic = friendly.replace(/^Loading\s+/i, '') || 'assets';
  setLoadingMessage(`Trouble loading ${topic.toLowerCase()}... Retrying or skipping...`);
}

function applySavedWorldState() {
  if (appliedWorldMapPath === currentMapPath) {
    return;
  }
  if (removedObjectKeys.size) {
    removedObjectKeys.forEach((key) => {
      removeObjectBySaveKey(scene, key);
    });
  }
  appliedWorldMapPath = currentMapPath;
}

function storeRemovalStateForCurrentMap() {
  removalState.set(currentMapPath, new Set(removedObjectKeys));
}

function collectGameState() {
  if (!camera || !cameraContainer) {
    return null;
  }
  const pistolState = getPistolState();
  storeRemovalStateForCurrentMap();
  const removedByMap = {};
  removalState.forEach((set, path) => {
    removedByMap[path] = Array.from(set);
  });
  removedByMap[currentMapPath] = Array.from(removedObjectKeys);
  return {
    player: {
      position: {
        x: cameraContainer.position.x,
        y: cameraContainer.position.y,
        z: cameraContainer.position.z
      },
      rotation: {
        yaw: cameraContainer.rotation.y,
        pitch: camera.rotation.x
      },
      health: playerHealth,
      pistol: pistolState
    },
    world: {
      mapPath: currentMapPath,
      removedObjectKeys: Array.from(removedObjectKeys),
      removedObjectKeysByMap: removedByMap
    }
  };
}

function saveGameState() {
  if (!canSaveProgress || isPlayerDead) {
    return false;
  }
  const data = collectGameState();
  if (!data) {
    return false;
  }
  return writeSaveData(data);
}

function startAutosaveLoop() {
  if (!canSaveProgress) {
    return;
  }
  if (autosaveIntervalId !== null) {
    clearInterval(autosaveIntervalId);
  }
  autosaveIntervalId = setInterval(() => {
    saveGameState();
  }, AUTOSAVE_INTERVAL_MS);
}

function stopAutosaveLoop() {
  if (autosaveIntervalId !== null) {
    clearInterval(autosaveIntervalId);
    autosaveIntervalId = null;
  }
  if (pendingQuickSaveTimeout !== null) {
    clearTimeout(pendingQuickSaveTimeout);
    pendingQuickSaveTimeout = null;
  }
}

function requestQuickSave(delay = QUICK_SAVE_DELAY_MS) {
  if (!canSaveProgress || isPlayerDead) {
    return;
  }
  if (pendingQuickSaveTimeout !== null) {
    return;
  }
  const safeDelay = Math.max(0, Number.isFinite(delay) ? delay : QUICK_SAVE_DELAY_MS);
  pendingQuickSaveTimeout = setTimeout(() => {
    pendingQuickSaveTimeout = null;
    saveGameState();
  }, safeDelay);
}

function restorePlayerStateFromSave() {
  if (playerStateRestored || !savedGameData || !savedGameData.player) {
    return;
  }
  const player = savedGameData.player;
  if (canRestorePlayerToCurrentMap) {
    const pos = player.position;
    if (pos && typeof pos === 'object') {
      const px = Number(pos.x ?? pos[0] ?? 0) || 0;
      const py = Number(pos.y ?? pos[1] ?? 0) || 0;
      const pz = Number(pos.z ?? pos[2] ?? 0) || 0;
      cameraContainer.position.set(px, py, pz);
    }
    const rot = player.rotation;
    if (rot && typeof rot === 'object') {
      const yaw = Number(rot.yaw ?? rot.y ?? 0);
      const pitch = Number(rot.pitch ?? rot.x ?? 0);
      if (Number.isFinite(yaw)) {
        cameraContainer.rotation.y = yaw;
      }
      if (Number.isFinite(pitch)) {
        camera.rotation.x = THREE.MathUtils.clamp(pitch, -Math.PI / 2, Math.PI / 2);
      }
    }
  }
  if (player.pistol) {
    setPistolState(player.pistol);
  }
  if (Number.isFinite(player.health)) {
    playerHealth = THREE.MathUtils.clamp(player.health, 0, PLAYER_MAX_HEALTH);
  }
  updateHUD(undefined, playerHealth);
  playerStateRestored = true;
}

function hideLoadingOverlay() {
  if (!loadingOverlay || loadingOverlayHidden) {
    return;
  }
  loadingOverlayHidden = true;
  loadingOverlay.classList.add('loading-overlay--hidden');
  setTimeout(() => {
    if (loadingOverlay.parentNode) {
      loadingOverlay.parentNode.removeChild(loadingOverlay);
    }
  }, 450);
}

function tryFinalizeLoading() {
  if (!loadingOverlay || loadingOverlayHidden) {
    return;
  }
  if (loadingManagerFinished && initializationFinished) {
    const total = lastProgressTotal > 0 ? lastProgressTotal : Math.max(lastProgressLoaded, 1);
    updateLoadingProgress(total, total);
    if (!initializationFailed) {
      setLoadingMessage('Ready!');
    }
    const delay = initializationFailed ? 600 : 250;
    setTimeout(() => hideLoadingOverlay(), delay);
  }
}

loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
  updateLoadingProgress(itemsLoaded, itemsTotal);
  if (url) {
    setLoadingMessageFromLabel(url);
  }
};

loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  updateLoadingProgress(itemsLoaded, itemsTotal);
  if (url) {
    setLoadingMessageFromLabel(url);
  }
};

loadingManager.onError = (url) => {
  if (url) {
    setLoadingErrorMessage(url);
  }
};

loadingManager.onLoad = () => {
  loadingManagerFinished = true;
  const total = lastProgressTotal > 0 ? lastProgressTotal : Math.max(lastProgressLoaded, 1);
  updateLoadingProgress(total, total);
  if (!initializationFinished && !initializationFailed) {
    setLoadingMessage('Finalizing...');
  }
  tryFinalizeLoading();
};

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

let isPlayerDead = false;
let movementEnableTimeout = null;

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
  if (isPlayerDead || playerHealth <= 0) {
    return;
  }

  hitSound.currentTime = 0;
  hitSound.play();
  if (dir) {
    const strength = 5; // initial knockback speed
    knockbackVelocity.copy(dir).multiplyScalar(strength);
  }
  if (movementEnableTimeout) {
    clearTimeout(movementEnableTimeout);
    movementEnableTimeout = null;
  }
  movement.setEnabled(false);
  spawnSplash();
  triggerShake();

  const previousHealth = playerHealth;
  playerHealth = Math.max(0, playerHealth - PLAYER_HIT_DAMAGE);
  if (playerHealth !== previousHealth) {
    updateHUD(undefined, playerHealth);
    requestQuickSave();
  }

  if (playerHealth > 0) {
    movementEnableTimeout = setTimeout(() => {
      if (!isPlayerDead) {
        movement.setEnabled(true);
      }
      movementEnableTimeout = null;
    }, 500);
  } else {
    handlePlayerDeath();
  }
}

function handlePlayerDeath() {
  if (isPlayerDead) {
    return;
  }
  isPlayerDead = true;

  stopAutosaveLoop();
  clearSaveData();
  removedObjectKeys.clear();
  removalState.clear();
  canSaveProgress = false;

  knockbackVelocity.set(0, 0, 0);
  canvas.style.transform = '';

  if (movementEnableTimeout) {
    clearTimeout(movementEnableTimeout);
    movementEnableTimeout = null;
  }
  movement.setEnabled(false);
  setPistolEnabled(false);
  setHUDVisible(false);
  setCrosshairVisible(false);
  setMinimapEnabled(false);
  canvas.style.pointerEvents = 'none';

  if (document.exitPointerLock) {
    document.exitPointerLock();
  }

  if (!deathOverlay) {
    deathOverlay = document.createElement('div');
    deathOverlay.style.position = 'fixed';
    deathOverlay.style.left = '0';
    deathOverlay.style.top = '0';
    deathOverlay.style.width = '100%';
    deathOverlay.style.height = '100%';
    deathOverlay.style.background = '#000';
    deathOverlay.style.display = 'flex';
    deathOverlay.style.flexDirection = 'column';
    deathOverlay.style.alignItems = 'center';
    deathOverlay.style.justifyContent = 'center';
    deathOverlay.style.gap = '24px';
    deathOverlay.style.zIndex = '150';
    deathOverlay.style.fontFamily = 'Arial, sans-serif';
    deathOverlay.style.color = '#ff4d4d';
    deathOverlay.style.textAlign = 'center';

    const deathMessage = document.createElement('div');
    deathMessage.textContent = 'YOU DIED';
    deathMessage.style.fontSize = '48px';
    deathMessage.style.fontWeight = 'bold';
    deathMessage.style.textShadow = '0 0 20px rgba(0, 0, 0, 0.9)';
    deathMessage.style.letterSpacing = '0.2em';
    deathMessage.style.pointerEvents = 'none';

    const restartButton = document.createElement('button');
    restartButton.textContent = 'Restart';
    restartButton.style.padding = '12px 24px';
    restartButton.style.fontSize = '18px';
    restartButton.style.border = 'none';
    restartButton.style.borderRadius = '4px';
    restartButton.style.cursor = 'pointer';
    restartButton.style.background = '#ffffff';
    restartButton.style.color = '#000000';
    restartButton.addEventListener('click', () => {
      window.location.reload();
    });

    deathOverlay.appendChild(deathMessage);
    deathOverlay.appendChild(restartButton);
    document.body.appendChild(deathOverlay);
  }
}

// ---- Torch (SpotLight) setup ----
const torch = setupTorch(camera, scene);
torch.layers.enable(1);

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
const textureLoader = new THREE.TextureLoader(loadingManager);
// Increased to ensure zombies remain within loaded map bounds
const PLAYER_VIEW_DISTANCE = 25;
const RANDOM_ZOMBIE_COUNT = 400;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_HIT_DAMAGE = 10;

let playerHealth = PLAYER_MAX_HEALTH;
let deathOverlay = null;
let zombieKillCount = 0;
let coinCount = 0;

// Track models for zombies/objects
const models = {};

async function fetchJSONWithTracking(url, { defaultValue = undefined, rethrow = false, label } = {}) {
  const itemLabel = label || url;
  if (loadingManager && typeof loadingManager.itemStart === 'function') {
    loadingManager.itemStart(itemLabel);
  }
  if (
    loadingManager &&
    typeof loadingManager.itemsLoaded === 'number' &&
    typeof loadingManager.itemsTotal === 'number'
  ) {
    updateLoadingProgress(loadingManager.itemsLoaded, loadingManager.itemsTotal);
  }
  setLoadingMessageFromLabel(itemLabel);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (rethrow || typeof defaultValue === 'undefined') {
        throw new Error(`HTTP ${response.status}`);
      }
      return defaultValue;
    }
    return await response.json();
  } catch (error) {
    if (rethrow || typeof defaultValue === 'undefined') {
      throw error;
    }
    console.warn(`Failed to load ${url}:`, error);
    return defaultValue;
  } finally {
    if (loadingManager && typeof loadingManager.itemEnd === 'function') {
      loadingManager.itemEnd(itemLabel);
    }
  }
}

async function loadCurrentMap({ skipRandomZombies = false } = {}) {
  clearZombies(scene);
  appliedWorldMapPath = null;
  const mapObjects = await loadMap(scene, currentMapPath);
  applySavedWorldState();
  setMinimapMapSource(currentMapPath);
  setLoadingMessage('Spawning zombies...');
  await spawnZombiesFromMap(scene, mapObjects, models, materials);
  const walkablePositions = getWalkablePositions();
  if (!MAP_RANDOM_ZOMBIES_DISABLED.has(currentMapPath) && !skipRandomZombies) {
    const spawnCount = Math.min(RANDOM_ZOMBIE_COUNT, walkablePositions.length);
    if (spawnCount > 0) {
      await spawnRandomZombies(scene, spawnCount, walkablePositions);
    }
  }
  storeRemovalStateForCurrentMap();
  return mapObjects;
}

async function transitionToMap(transition) {
  if (isTransitioningMap || isPlayerDead) {
    return;
  }
  if (!transition || !transition.targetMap) {
    return;
  }
  const sanitizedTarget = sanitizeMapPath(transition.targetMap) || DEFAULT_MAP_PATH;
  if (sanitizedTarget === currentMapPath) {
    return;
  }

  isTransitioningMap = true;
  const previousMapPath = currentMapPath;
  const previousPosition = cameraContainer.position.clone();
  const previousYaw = cameraContainer.rotation.y;
  const previousPitch = camera.rotation.x;
  const previousRemovedKeys = new Set(removedObjectKeys);

  try {
    movement.setEnabled(false);
    setPistolEnabled(false);
    storeRemovalStateForCurrentMap();
    removalState.set(previousMapPath, new Set(removedObjectKeys));

    currentMapPath = sanitizedTarget;
    removedObjectKeys = new Set(removalState.get(currentMapPath) || []);
    updateURLForCurrentMap();

    await loadCurrentMap();

    const spawn = transition.spawn || {};
    const spawnPos = spawn.position || spawn.pos || null;
    if (spawnPos && typeof spawnPos === 'object') {
      const sx = Number(spawnPos.x ?? spawnPos[0]);
      const sy = Number(spawnPos.y ?? spawnPos[1]);
      const sz = Number(spawnPos.z ?? spawnPos[2]);
      cameraContainer.position.set(
        Number.isFinite(sx) ? sx : cameraContainer.position.x,
        Number.isFinite(sy) ? sy : cameraContainer.position.y,
        Number.isFinite(sz) ? sz : cameraContainer.position.z
      );
    } else {
      cameraContainer.position.set(0, 0, 0);
    }

    if (Number.isFinite(spawn.rotation)) {
      cameraContainer.rotation.y = spawn.rotation;
    }
    camera.rotation.x = 0;
    knockbackVelocity.set(0, 0, 0);
    lastChunkX = null;
    lastChunkZ = null;
    storeRemovalStateForCurrentMap();
    requestQuickSave(QUICK_SAVE_DELAY_MS);
  } catch (error) {
    console.error('Failed to switch maps:', error);
    currentMapPath = previousMapPath;
    removedObjectKeys = new Set(previousRemovedKeys);
    updateURLForCurrentMap();
    try {
      await loadCurrentMap();
      cameraContainer.position.copy(previousPosition);
      cameraContainer.rotation.y = previousYaw;
      camera.rotation.x = previousPitch;
      storeRemovalStateForCurrentMap();
    } catch (reloadError) {
      console.error('Failed to reload previous map after error:', reloadError);
    }
  } finally {
    if (!isPlayerDead) {
      setPistolEnabled(true);
      movement.setEnabled(true);
    }
    isTransitioningMap = false;
  }
}

async function tryInteractWithCar() {
  if (isTransitioningMap || isPlayerDead || !isPointerLocked) {
    return;
  }
  const transition = MAP_TRANSITIONS[currentMapPath];
  if (!transition) {
    return;
  }
  const objects = getLoadedObjects();
  let hasNearbyCar = false;
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || obj.userData?.type !== '3d car') {
      continue;
    }
    const dx = obj.position.x - cameraContainer.position.x;
    const dz = obj.position.z - cameraContainer.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= CAR_INTERACT_DISTANCE_SQ) {
      hasNearbyCar = true;
      break;
    }
  }
  if (!hasNearbyCar) {
    return;
  }
  await transitionToMap(transition);
}

async function initializeGame() {
  try {
    const [objects, zombies] = await Promise.all([
      fetchJSONWithTracking('objects.json', { defaultValue: [] }),
      fetchJSONWithTracking('zombies.json', { defaultValue: [] })
    ]);
    const allDefs = [...objects, ...zombies];

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

      if (obj.model && window.THREE.GLTFLoader) {
        const loader = new THREE.GLTFLoader(loadingManager);
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

    await loadCurrentMap();
  } catch (err) {
    initializationFailed = true;
    console.error('Error loading object/zombie definitions:', err);
    setLoadingMessage('Failed to initialize game.');
    alert('Failed to load object or zombie definitions.');
  } finally {
    initializationFinished = true;
    if (!initializationFailed) {
      canSaveProgress = true;
      startAutosaveLoop();
      requestQuickSave(QUICK_SAVE_DELAY_MS);
    }
    tryFinalizeLoading();
  }
}

initializeGame();

// --- Controls, HUD, Movement, etc ---
const movement = setupMovement(cameraContainer, camera, scene);
initHUD(PLAYER_MAX_HEALTH);
updateHUD(10, playerHealth);
updateKillCount(zombieKillCount);
updateCoinCount(coinCount);
initCrosshair();
enablePointerLock(renderer, cameraContainer, camera);
setupZoom(camera, weaponCamera);
addPistolToCamera(weaponCamera);
initMinimap();
setMinimapMapSource(currentMapPath);
if (!loadingOverlayHidden) {
  setLoadingMessageFromLabel('settings');
}
initZombieSettingsUI();
restorePlayerStateFromSave();

document.addEventListener('mousedown', (e) => {
  if (isPlayerDead) return;
  if (!isPointerLocked) return;
  if (e.button === 0) shootPistol(scene, camera);
});

// Toggle "Gods sun" spotlight with the L key
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyI' && !e.repeat) {
    toggleStatsVisibility();
  }
  if (e.code === 'KeyE' && !e.repeat) {
    tryInteractWithCar();
  }
  if (isPlayerDead) return;
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
  zombieKillCount += 1;
  updateKillCount(zombieKillCount);
  spawnKillFlash();
  triggerShake();
});

window.addEventListener('coinCollected', (event) => {
  const amount = Number(event?.detail?.amount ?? 1);
  if (!Number.isFinite(amount)) {
    return;
  }
  coinCount = Math.max(0, coinCount + amount);
  updateCoinCount(coinCount);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  positionCrosshair();
});

window.addEventListener('gameObjectRemoved', (event) => {
  const key = event?.detail?.saveKey;
  if (typeof key !== 'string' || !key) {
    return;
  }
  removedObjectKeys.add(key);
  removeObjectBySaveKey(scene, key);
  storeRemovalStateForCurrentMap();
  requestQuickSave();
});

// --- Chunk-based culling/performance ---
let lastChunkX = null, lastChunkZ = null;
const UPDATE_CHUNK_SIZE = 5;

// --- Torch direction logic ---
const spotlightTargetPos = new THREE.Vector3();
const spotlightTargetDir = new THREE.Vector3();

function updateSpotlightTarget(camera, spotlight) {
  camera.getWorldPosition(spotlightTargetPos);
  camera.getWorldDirection(spotlightTargetDir);
  spotlight.target.position
    .copy(spotlightTargetPos)
    .addScaledVector(spotlightTargetDir, 10);
  if (spotlight.target.parent !== scene) scene.add(spotlight.target);
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

  updateTorchFlicker(performance.now());
  updateTorchTarget(camera);
  updateSpotlightTarget(camera, godsSun);

  // ---- Zombie animation & AI update ----
  updateZombies(delta, cameraContainer, handlePlayerHit, movement.getState());
  updateBloodEffects(delta);

  checkPickups(cameraContainer, scene);
  updateBullets(delta);
  updateDoors(delta);
  updateMinimap(cameraContainer, camera, getLoadedObjects());

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(scene, weaponCamera);
  drawCrosshair(delta);
}

window.addEventListener('beforeunload', () => {
  saveGameState();
});

window.onload = () => {
  positionCrosshair();
  animate();
};

let canvas, ctx;

const CROSSHAIR_SIZE = 64;
const HALF_SIZE = CROSSHAIR_SIZE / 2;
const LINE_WIDTH = 2;
const ARM_LENGTH = 10;
const BASE_GAP = 12;
const MOVING_GAP = 24;
const SHOOT_RECOIL = 28;
const RECOIL_DECAY = 30; // Units of gap per second removed after firing
const SMOOTH_SPEED = 12; // Higher values snap faster to the desired gap

let currentGap = BASE_GAP;
let moving = false;
let recoilGap = 0;

export function initCrosshair() {
    canvas = document.createElement('canvas');
    canvas.width = CROSSHAIR_SIZE;
    canvas.height = CROSSHAIR_SIZE;
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1000';
    document.body.appendChild(canvas);

    ctx = canvas.getContext('2d');
    positionCrosshair();
}

export function drawCrosshair(delta = 0.016) {
    if (!ctx) return;

    recoilGap = Math.max(0, recoilGap - RECOIL_DECAY * delta);
    const desiredGap = Math.max(
        BASE_GAP,
        moving ? MOVING_GAP : BASE_GAP,
        BASE_GAP + recoilGap
    );

    const lerp = Math.min(delta * SMOOTH_SPEED, 1);
    currentGap += (desiredGap - currentGap) * lerp;

    ctx.clearRect(0, 0, CROSSHAIR_SIZE, CROSSHAIR_SIZE);
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';

    const center = HALF_SIZE;
    const gap = currentGap;
    const length = ARM_LENGTH;

    // Up
    ctx.beginPath();
    ctx.moveTo(center, center - gap - length);
    ctx.lineTo(center, center - gap);
    ctx.stroke();

    // Down
    ctx.beginPath();
    ctx.moveTo(center, center + gap);
    ctx.lineTo(center, center + gap + length);
    ctx.stroke();

    // Left
    ctx.beginPath();
    ctx.moveTo(center - gap - length, center);
    ctx.lineTo(center - gap, center);
    ctx.stroke();

    // Right
    ctx.beginPath();
    ctx.moveTo(center + gap, center);
    ctx.lineTo(center + gap + length, center);
    ctx.stroke();
}

export function positionCrosshair() {
    if (!canvas) return;
    canvas.style.left = `${(window.innerWidth - CROSSHAIR_SIZE) / 2}px`;
    canvas.style.top = `${(window.innerHeight - CROSSHAIR_SIZE) / 2}px`;
}

export function setCrosshairMoving(isMoving) {
    moving = isMoving;
}

export function notifyCrosshairShot() {
    recoilGap = Math.max(recoilGap, SHOOT_RECOIL);
}

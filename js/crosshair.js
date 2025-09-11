let canvas, ctx;

export function initCrosshair() {
    canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 30;
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    ctx = canvas.getContext('2d');
    positionCrosshair();
}

export function drawCrosshair() {
    ctx.clearRect(0, 0, 30, 30);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(15, 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(30, 15); ctx.stroke();
}

export function positionCrosshair() {
    canvas.style.left = `${(window.innerWidth - 30) / 2}px`;
    canvas.style.top = `${(window.innerHeight - 30) / 2}px`;
}

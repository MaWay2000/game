let isZoomed = false;

export function setupZoom(camera) {
    window.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            isZoomed = true;
            camera.fov = 30;
            camera.updateProjectionMatrix();
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isZoomed = false;
            camera.fov = 75;
            camera.updateProjectionMatrix();
        }
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
}

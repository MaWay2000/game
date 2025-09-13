let isZoomed = false;

export function setupZoom(...cameras) {
    window.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            isZoomed = true;
            cameras.forEach(cam => {
                cam.fov = 30;
                cam.updateProjectionMatrix();
            });
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isZoomed = false;
            cameras.forEach(cam => {
                cam.fov = 75;
                cam.updateProjectionMatrix();
            });
        }
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
}

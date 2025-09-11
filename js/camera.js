let cameraContainer;
let camera;

export function setupCamera() {
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);

    cameraContainer = new THREE.Object3D();
    cameraContainer.position.set(0, 0, 5);
    cameraContainer.add(camera);

    return { camera, cameraContainer };
}

export function enablePointerLock(renderer, cameraContainerRef, cameraRef) {
    const canvas = renderer.domElement;

    canvas.addEventListener('click', () => {
        canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            document.addEventListener('mousemove', onMouseMove, false);
        } else {
            document.removeEventListener('mousemove', onMouseMove, false);
        }
    });

    function onMouseMove(event) {
        cameraContainerRef.rotation.y -= event.movementX * 0.002;
        cameraRef.rotation.x -= event.movementY * 0.002;
        cameraRef.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRef.rotation.x));
    }
}

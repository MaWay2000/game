let hudContainer, healthEl, ammoContainer;

export function initHUD() {
    hudContainer = document.createElement('div');
    hudContainer.style.position = 'absolute';
    hudContainer.style.bottom = '10px';
    hudContainer.style.right = '10px';
    hudContainer.style.zIndex = '100';
    hudContainer.style.fontFamily = 'Arial';
    hudContainer.style.color = 'white';
    hudContainer.style.fontSize = '16px';

    // Health display (top-right text)
    healthEl = document.createElement('div');
    healthEl.style.position = 'absolute';
    healthEl.style.top = '10px';
    healthEl.style.left = '10px';
    healthEl.textContent = 'Health: 100';
    document.body.appendChild(healthEl);

    // Ammo display (bottom-right icons)
    ammoContainer = document.createElement('div');
    ammoContainer.style.display = 'flex';
    ammoContainer.style.gap = '4px';
    ammoContainer.style.justifyContent = 'flex-end';
    ammoContainer.style.alignItems = 'center';
    hudContainer.appendChild(ammoContainer);

    document.body.appendChild(hudContainer);
}

export function updateHUD(ammo, health) {
    // Update health text
    healthEl.textContent = `Health: ${health}`;

    // Clear and redraw bullets
    ammoContainer.innerHTML = '';
    for (let i = 0; i < ammo; i++) {
        const bullet = document.createElement('img');
        bullet.src = 'images/bullet.png';
        bullet.style.width = '20px';
        bullet.style.height = '20px';
        bullet.style.imageRendering = 'pixelated';
        ammoContainer.appendChild(bullet);
    }
}

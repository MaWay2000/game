let hudContainer, ammoContainer, healthContainer, healthBarFill, healthText;
let maxHealth = 100;
let currentHealth = 100;

export function initHUD(maxHealthValue = 100) {
    maxHealth = Math.max(1, maxHealthValue);
    currentHealth = maxHealth;

    hudContainer = document.createElement('div');
    hudContainer.style.position = 'absolute';
    hudContainer.style.bottom = '10px';
    hudContainer.style.right = '10px';
    hudContainer.style.zIndex = '100';
    hudContainer.style.fontFamily = 'Arial, sans-serif';
    hudContainer.style.color = 'white';
    hudContainer.style.fontSize = '16px';

    // Ammo display (bottom-right icons)
    ammoContainer = document.createElement('div');
    ammoContainer.style.display = 'flex';
    ammoContainer.style.gap = '4px';
    ammoContainer.style.justifyContent = 'flex-end';
    ammoContainer.style.alignItems = 'center';
    hudContainer.appendChild(ammoContainer);

    document.body.appendChild(hudContainer);

    // Health bar (bottom center)
    healthContainer = document.createElement('div');
    healthContainer.style.position = 'absolute';
    healthContainer.style.bottom = '24px';
    healthContainer.style.left = '50%';
    healthContainer.style.transform = 'translateX(-50%)';
    healthContainer.style.width = '320px';
    healthContainer.style.height = '26px';
    healthContainer.style.padding = '4px';
    healthContainer.style.borderRadius = '16px';
    healthContainer.style.background = 'rgba(0, 0, 0, 0.4)';
    healthContainer.style.border = '2px solid rgba(255, 255, 255, 0.25)';
    healthContainer.style.backdropFilter = 'blur(4px)';
    healthContainer.style.pointerEvents = 'none';
    healthContainer.style.zIndex = '101';

    const healthBar = document.createElement('div');
    healthBar.style.position = 'relative';
    healthBar.style.width = '100%';
    healthBar.style.height = '100%';
    healthBar.style.borderRadius = '12px';
    healthBar.style.background = 'rgba(255, 255, 255, 0.08)';

    healthBarFill = document.createElement('div');
    healthBarFill.style.position = 'absolute';
    healthBarFill.style.left = '0';
    healthBarFill.style.top = '0';
    healthBarFill.style.height = '100%';
    healthBarFill.style.borderRadius = '12px';
    healthBarFill.style.width = '100%';
    healthBarFill.style.transition = 'width 0.2s ease-out';
    healthBarFill.style.boxShadow = '0 0 12px rgba(255, 60, 60, 0.4)';

    healthText = document.createElement('span');
    healthText.style.position = 'absolute';
    healthText.style.left = '0';
    healthText.style.top = '50%';
    healthText.style.transform = 'translateY(-50%)';
    healthText.style.width = '100%';
    healthText.style.textAlign = 'center';
    healthText.style.fontWeight = 'bold';
    healthText.style.letterSpacing = '0.08em';
    healthText.style.fontSize = '14px';
    healthText.style.color = '#ffffff';
    healthText.style.textShadow = '0 0 8px rgba(0, 0, 0, 0.9)';
    healthText.textContent = `${currentHealth} / ${maxHealth}`;

    healthBar.appendChild(healthBarFill);
    healthBar.appendChild(healthText);
    healthContainer.appendChild(healthBar);
    document.body.appendChild(healthContainer);

    renderHealthBar();
}

function renderHealthBar() {
    if (!healthBarFill || !healthText) return;
    const clamped = Math.max(0, Math.min(currentHealth, maxHealth));
    const percent = (clamped / maxHealth) * 100;
    healthBarFill.style.width = `${percent}%`;

    const hue = (percent / 100) * 110; // 0 (red) -> 110 (green)
    const primary = `hsl(${Math.max(0, hue - 10)}, 80%, 50%)`;
    const secondary = `hsl(${Math.max(0, hue + 10)}, 85%, 45%)`;
    healthBarFill.style.background = `linear-gradient(90deg, ${secondary}, ${primary})`;
    healthBarFill.style.boxShadow = `0 0 16px hsla(${Math.max(0, hue)}, 80%, 50%, 0.45)`;

    healthText.textContent = `HEALTH ${Math.round(clamped)} / ${maxHealth}`;
}

export function updateHUD(ammo, health) {
    if (!hudContainer) return;

    if (typeof ammo === 'number' && ammoContainer) {
        ammoContainer.innerHTML = '';
        const ammoCount = Math.max(0, Math.floor(ammo));
        for (let i = 0; i < ammoCount; i++) {
            const bullet = document.createElement('img');
            bullet.src = 'images/bullet.png';
            bullet.style.width = '20px';
            bullet.style.height = '20px';
            bullet.style.imageRendering = 'pixelated';
            ammoContainer.appendChild(bullet);
        }
    }

    if (typeof health === 'number') {
        currentHealth = Math.max(0, Math.min(health, maxHealth));
        renderHealthBar();
    }
}

export function setHUDVisible(visible) {
    const display = visible ? 'block' : 'none';
    if (hudContainer) {
        hudContainer.style.display = display;
    }
    if (healthContainer) {
        healthContainer.style.display = display;
    }
}

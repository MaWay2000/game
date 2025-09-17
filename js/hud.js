let hudContainer, ammoContainer, healthContainer, healthBarFill, healthText;
let statsContainer, killCountText;
let maxHealth = 100;
let currentHealth = 100;
let currentKillCount = 0;
let hudVisible = true;
let statsVisible = false;

export function initHUD(maxHealthValue = 100) {
    maxHealth = Math.max(1, maxHealthValue);
    currentHealth = maxHealth;
    currentKillCount = 0;
    hudVisible = true;
    statsVisible = false;

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

    statsContainer = document.createElement('div');
    statsContainer.style.position = 'absolute';
    statsContainer.style.top = '16px';
    statsContainer.style.left = '16px';
    statsContainer.style.padding = '12px 16px';
    statsContainer.style.borderRadius = '12px';
    statsContainer.style.background = 'rgba(0, 0, 0, 0.55)';
    statsContainer.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    statsContainer.style.backdropFilter = 'blur(6px)';
    statsContainer.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.35)';
    statsContainer.style.color = '#ffffff';
    statsContainer.style.fontFamily = 'Arial, sans-serif';
    statsContainer.style.fontSize = '15px';
    statsContainer.style.letterSpacing = '0.06em';
    statsContainer.style.lineHeight = '1.4';
    statsContainer.style.textTransform = 'uppercase';
    statsContainer.style.pointerEvents = 'none';
    statsContainer.style.zIndex = '102';
    statsContainer.style.display = 'none';

    const statsTitle = document.createElement('div');
    statsTitle.textContent = 'Player Stats';
    statsTitle.style.fontSize = '12px';
    statsTitle.style.opacity = '0.75';
    statsTitle.style.marginBottom = '6px';
    statsContainer.appendChild(statsTitle);

    killCountText = document.createElement('div');
    killCountText.style.fontSize = '16px';
    killCountText.style.fontWeight = 'bold';
    killCountText.style.textShadow = '0 0 12px rgba(0, 0, 0, 0.7)';
    statsContainer.appendChild(killCountText);

    const statsHint = document.createElement('div');
    statsHint.textContent = 'Press I to close';
    statsHint.style.fontSize = '11px';
    statsHint.style.opacity = '0.7';
    statsHint.style.marginTop = '8px';
    statsContainer.appendChild(statsHint);

    document.body.appendChild(statsContainer);

    renderHealthBar();
    renderKillCount();
    renderStatsVisibility();
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

function renderKillCount() {
    if (!killCountText) return;
    killCountText.textContent = `ZOMBIES KILLED ${currentKillCount}`;
}

function renderStatsVisibility() {
    if (!statsContainer) return;
    statsContainer.style.display = hudVisible && statsVisible ? 'block' : 'none';
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
    hudVisible = !!visible;
    const display = hudVisible ? 'block' : 'none';
    if (hudContainer) {
        hudContainer.style.display = display;
    }
    if (healthContainer) {
        healthContainer.style.display = display;
    }
    renderStatsVisibility();
}

export function updateKillCount(kills) {
    if (typeof kills === 'number' && Number.isFinite(kills)) {
        currentKillCount = Math.max(0, Math.floor(kills));
    }
    renderKillCount();
}

export function setStatsVisible(visible) {
    statsVisible = !!visible;
    renderStatsVisibility();
}

export function toggleStatsVisibility() {
    setStatsVisible(!statsVisible);
}

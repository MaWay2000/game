<?php
$filename = 'zombies.json';

// Charset & color safety
function safeColor($color) {
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) return '#cccccc';
    return $color;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    file_put_contents($filename, $_POST['data']);
    header('Location: zombie_editor.php?saved=1');
    exit;
}

$zombies = [];
if (file_exists($filename)) {
    $zombies = json_decode(file_get_contents($filename), true) ?? [];
}
$saved = isset($_GET['saved']);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>?? Zombie Editor</title>
    <style>
        body { font-family: Arial, sans-serif; background: #222; color: #eee; padding: 20px; }
        input, button { padding: 5px; margin: 0 3px 0 0; }
        .zombie-box {
            background: #333;
            padding: 10px;
            margin: 8px 0;
            border-radius: 5px;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }
        .zombie-box label {
            display: flex;
            align-items: center;
            margin-right: 8px;
            margin-bottom: 0;
        }
        .zombie-box input, .zombie-box select {
            margin-bottom: 0;
        }
        .zombie-remove { margin-left: 12px; }
    </style>
</head>
<body>
    <h2>?? Zombie Editor</h2>
    <?php if ($saved): ?>
        <p style="color: lightgreen;">? Zombies saved!</p>
    <?php endif; ?>

    <form method="post">
        <div id="editorArea">
        <?php foreach ($zombies as $i => $z): ?>
            <div class="zombie-box">
                <label>ID: <input name="id[]" value="<?= htmlspecialchars($z['id'], ENT_QUOTES, 'UTF-8') ?>" style="width:35px"></label>
                <label>Name: <input name="name[]" value="<?= htmlspecialchars($z['name'], ENT_QUOTES, 'UTF-8') ?>" style="width:80px"></label>
                <label>Color: <input type="color" name="color[]" value="<?= htmlspecialchars(safeColor($z['color']), ENT_QUOTES, 'UTF-8') ?>"></label>
                <label>Size: 
                    <input type="number" step="0.01" name="sizeX[]" value="<?= floatval($z['size'][0]) ?>" style="width:35px">
                    ×
                    <input type="number" step="0.01" name="sizeY[]" value="<?= floatval($z['size'][1]) ?>" style="width:35px">
                    ×
                    <input type="number" step="0.01" name="sizeZ[]" value="<?= floatval($z['size'][2]) ?>" style="width:35px">
                </label>
                <label>Model: <input name="model[]" value="<?= isset($z['model']) ? htmlspecialchars($z['model'], ENT_QUOTES, 'UTF-8') : '' ?>" placeholder="models/zombie.glb" style="width:120px"></label>
                <label>Collidable: <input type="checkbox" name="collidable[]" <?= !empty($z['collidable']) ? 'checked' : '' ?>></label>
                <label>HP: <input type="number" name="hp[]" value="<?= isset($z['hp']) ? intval($z['hp']) : 15 ?>" style="width:40px"></label>
                <label>Speed: <input type="number" step="0.01" name="speed[]" value="<?= isset($z['speed']) ? floatval($z['speed']) : 0.03 ?>" style="width:40px"></label>
                <label>Damage: <input type="number" name="damage[]" value="<?= isset($z['damage']) ? intval($z['damage']) : 5 ?>" style="width:35px"></label>
                <label>Attack Range: <input type="number" step="0.01" name="attack_range[]" value="<?= isset($z['attack_range']) ? floatval($z['attack_range']) : 1.2 ?>" style="width:40px"></label>
                <label>Aggro Range: <input type="number" name="aggro_range[]" value="<?= isset($z['aggro_range']) ? intval($z['aggro_range']) : 6 ?>" style="width:40px"></label>
                <label>Spot Distance: <input type="number" step="0.1" name="spotDistance[]" value="<?= isset($z['spotDistance']) ? floatval($z['spotDistance']) : 8 ?>" style="width:50px"></label>
                <label>Loot: <input name="loot[]" value="<?= isset($z['loot']) ? htmlspecialchars($z['loot'], ENT_QUOTES, 'UTF-8') : '' ?>" style="width:60px"></label>
                <button type="button" class="zombie-remove" onclick="removeZombie(this)">?? Remove</button>
            </div>
        <?php endforeach; ?>
        </div>
        <button type="button" onclick="addZombie()">? Add Zombie</button>
        <br><br>
        <input type="hidden" name="data" id="dataField">
        <button type="submit" onclick="prepareData()">?? Save Zombies</button>
    </form>

<script>
function addZombie() {
    const div = document.createElement('div');
    div.className = 'zombie-box';
    div.innerHTML = `
        <label>ID: <input name="id[]" value="" style="width:35px"></label>
        <label>Name: <input name="name[]" value="" style="width:80px"></label>
        <label>Color: <input type="color" name="color[]" value="#cccccc"></label>
        <label>Size:
            <input type="number" step="0.01" name="sizeX[]" value="0.7" style="width:35px"> ×
            <input type="number" step="0.01" name="sizeY[]" value="1.8" style="width:35px"> ×
            <input type="number" step="0.01" name="sizeZ[]" value="0.7" style="width:35px">
        </label>
        <label>Model: <input name="model[]" value="" placeholder="models/zombie.glb" style="width:120px"></label>
        <label>Collidable: <input type="checkbox" name="collidable[]" checked></label>
        <label>HP: <input type="number" name="hp[]" value="15" style="width:40px"></label>
        <label>Speed: <input type="number" step="0.01" name="speed[]" value="0.03" style="width:40px"></label>
        <label>Damage: <input type="number" name="damage[]" value="5" style="width:35px"></label>
        <label>Attack Range: <input type="number" step="0.01" name="attack_range[]" value="1.2" style="width:40px"></label>
        <label>Aggro Range: <input type="number" name="aggro_range[]" value="6" style="width:40px"></label>
        <label>Spot Distance: <input type="number" step="0.1" name="spotDistance[]" value="8" style="width:50px"></label>
        <label>Loot: <input name="loot[]" value="" style="width:60px"></label>
        <button type="button" class="zombie-remove" onclick="removeZombie(this)">?? Remove</button>
    `;
    document.getElementById('editorArea').appendChild(div);
}

function removeZombie(btn) {
    btn.parentNode.remove();
}

function prepareData() {
    const ids = Array.from(document.getElementsByName('id[]')).map(i => i.value.trim());
    const names = Array.from(document.getElementsByName('name[]')).map(i => i.value.trim());
    const colors = Array.from(document.getElementsByName('color[]')).map(i => i.value.trim());
    const sizeX = Array.from(document.getElementsByName('sizeX[]')).map(i => parseFloat(i.value));
    const sizeY = Array.from(document.getElementsByName('sizeY[]')).map(i => parseFloat(i.value));
    const sizeZ = Array.from(document.getElementsByName('sizeZ[]')).map(i => parseFloat(i.value));
    const models = Array.from(document.getElementsByName('model[]')).map(i => i.value.trim());
    const collidables = Array.from(document.getElementsByName('collidable[]')).map(i => i.checked);
    const hps = Array.from(document.getElementsByName('hp[]')).map(i => parseInt(i.value) || 15);
    const speeds = Array.from(document.getElementsByName('speed[]')).map(i => parseFloat(i.value) || 0.03);
    const damages = Array.from(document.getElementsByName('damage[]')).map(i => parseInt(i.value) || 5);
    const attack_ranges = Array.from(document.getElementsByName('attack_range[]')).map(i => parseFloat(i.value) || 1.2);
    const aggro_ranges = Array.from(document.getElementsByName('aggro_range[]')).map(i => parseInt(i.value) || 6);
    const spotDistances = Array.from(document.getElementsByName('spotDistance[]')).map(i => parseFloat(i.value) || 8);
    const loots = Array.from(document.getElementsByName('loot[]')).map(i => i.value.trim());

    const final = ids.map((id, i) => ({
        id,
        name: names[i],
        color: colors[i].startsWith('#') ? colors[i] : '#cccccc',
        size: [sizeX[i], sizeY[i], sizeZ[i]],
        model: models[i] || undefined,
        collidable: collidables[i],
        hp: hps[i],
        speed: speeds[i],
        damage: damages[i],
        attack_range: attack_ranges[i],
        aggro_range: aggro_ranges[i],
        spotDistance: spotDistances[i],
        loot: loots[i],
        ai: true   // <--- THIS!
    }));

    document.getElementById('dataField').value = JSON.stringify(final, null, 2);
}
</script>
</body>
</html>

<?php
$filename = 'objects.json';

function safeColor($color) {
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
        return '#cccccc';
    }
    return $color;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Defensive: Validate JSON before saving
    $json = $_POST['data'];
    json_decode($json);
    if (json_last_error() === JSON_ERROR_NONE) {
        file_put_contents($filename, $json);
        header('Location: objects_editor.php?saved=1');
        exit;
    } else {
        $errorMsg = 'Cannot save: JSON is invalid! Error: ' . json_last_error_msg();
    }
}

$objects = [];
if (file_exists($filename)) {
    $filedata = file_get_contents($filename);
    $objects = json_decode($filedata, true);
    if (!is_array($objects)) $objects = [];
}
$saved = isset($_GET['saved']);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Object Types Editor</title>
    <style>
        body { font-family: Arial, sans-serif; background: #222; color: #eee; padding: 20px; }
        input, button { padding: 5px; margin: 3px; }
        .object-box {
            background: #333;
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
        }
        label {
            display: inline-block;
            margin-right: 15px;
            vertical-align: middle;
        }
        .error-message {
            color: #ff8888;
            font-weight: bold;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <h2>??? Object Types Editor</h2>

    <?php if (!empty($errorMsg)): ?>
        <div class="error-message"><?= htmlspecialchars($errorMsg, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>
    <?php if ($saved): ?>
        <p style="color: lightgreen;">? Changes saved successfully!</p>
    <?php endif; ?>

    <form method="post" onsubmit="return prepareData();">
        <div id="editorArea">
            <?php foreach ($objects as $i => $obj): ?>
                <div class="object-box">
                    <label>ID: <input name="id[]" value="<?= htmlspecialchars($obj['id'], ENT_QUOTES, 'UTF-8') ?>"></label>
                    <label>Name: <input name="name[]" value="<?= htmlspecialchars($obj['name'], ENT_QUOTES, 'UTF-8') ?>"></label>
                    <label>Color:
                        <input type="color" name="color[]" value="<?= htmlspecialchars(safeColor($obj['color']), ENT_QUOTES, 'UTF-8') ?>">
                    </label>
                    <label>Size:
                        <input type="number" step="0.01" name="sizeX[]" value="<?= floatval($obj['size'][0]) ?>" style="width:50px"> ×
                        <input type="number" step="0.01" name="sizeY[]" value="<?= floatval($obj['size'][1]) ?>" style="width:50px"> ×
                        <input type="number" step="0.01" name="sizeZ[]" value="<?= floatval($obj['size'][2]) ?>" style="width:50px">
                    </label>
                    <label>Collidable:
                        <input type="checkbox" name="collidable[]" <?= !empty($obj['collidable']) ? 'checked' : '' ?>>
                    </label>
                    <label>Model: 
                        <input name="model[]" value="<?= isset($obj['model']) ? htmlspecialchars($obj['model'], ENT_QUOTES, 'UTF-8') : '' ?>" placeholder="models/item.glb" style="width:200px">
                    </label>
                    <label>Texture: 
                        <input name="texture[]" value="<?= isset($obj['texture']) ? htmlspecialchars($obj['texture'], ENT_QUOTES, 'UTF-8') : '' ?>" placeholder="images/texture.jpg" style="width:180px">
                    </label>
                    <button type="button" onclick="removeObject(this)">? Remove</button>
                </div>
            <?php endforeach; ?>
        </div>

        <button type="button" onclick="addObject()">? Add Object</button>
        <br><br>
        <input type="hidden" name="data" id="dataField">
        <button type="submit">?? Save All</button>
    </form>

<script>
function addObject() {
    const div = document.createElement('div');
    div.className = 'object-box';
    div.innerHTML = `
        <label>ID: <input name="id[]" value=""></label>
        <label>Name: <input name="name[]" value=""></label>
        <label>Color: <input type="color" name="color[]" value="#cccccc"></label>
        <label>Size:
            <input type="number" step="0.01" name="sizeX[]" value="1" style="width:50px"> ×
            <input type="number" step="0.01" name="sizeY[]" value="1" style="width:50px"> ×
            <input type="number" step="0.01" name="sizeZ[]" value="1" style="width:50px">
        </label>
        <label>Collidable: <input type="checkbox" name="collidable[]" checked></label>
        <label>Model: <input name="model[]" value="" placeholder="models/item.glb" style="width:200px"></label>
        <label>Texture: <input name="texture[]" value="" placeholder="images/texture.jpg" style="width:180px"></label>
        <button type="button" onclick="removeObject(this)">? Remove</button>
    `;
    document.getElementById('editorArea').appendChild(div);
}

function removeObject(btn) {
    btn.parentNode.remove();
}

// Make sure to always produce valid JSON, and check before submitting
function prepareData() {
    const ids = Array.from(document.getElementsByName('id[]')).map(i => i.value.trim());
    const names = Array.from(document.getElementsByName('name[]')).map(i => i.value.trim());
    const colors = Array.from(document.getElementsByName('color[]')).map(i => i.value.trim());
    const sizeX = Array.from(document.getElementsByName('sizeX[]')).map(i => parseFloat(i.value));
    const sizeY = Array.from(document.getElementsByName('sizeY[]')).map(i => parseFloat(i.value));
    const sizeZ = Array.from(document.getElementsByName('sizeZ[]')).map(i => parseFloat(i.value));
    const collidables = Array.from(document.getElementsByName('collidable[]')).map(i => i.checked);
    const models = Array.from(document.getElementsByName('model[]')).map(i => i.value.trim());
    const textures = Array.from(document.getElementsByName('texture[]')).map(i => i.value.trim());

    // Filter out empty IDs to avoid broken/incomplete objects
    const final = ids.map((id, i) => ({
        id,
        name: names[i],
        color: colors[i].startsWith('#') ? colors[i] : '#cccccc',
        size: [sizeX[i], sizeY[i], sizeZ[i]],
        collidable: collidables[i],
        model: models[i] || undefined,
        texture: textures[i] || undefined
    })).filter(obj => obj.id);

    // Stringify and validate before submit
    const json = JSON.stringify(final, null, 2);

    try {
        JSON.parse(json);
    } catch (e) {
        alert('Cannot save: JSON is invalid!\n\n' + e);
        return false; // Prevent form submit
    }

    document.getElementById('dataField').value = json;
    return true;
}
</script>
</body>
</html>

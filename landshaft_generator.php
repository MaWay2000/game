<?php
header('Content-Type: application/json');

// Read input JSON
$input = json_decode(file_get_contents('php://input'), true);

$mapSize = $input['map_size'] ?? 1000;
$hillDensity = $input['hill_density'] ?? 10;
$hillHeight = $input['hill_height'] ?? 10;
$lakeCount = $input['lake_count'] ?? 4;
$riverCount = $input['river_count'] ?? 1;

$result = [];

// Generate hills
$numHills = intval($mapSize * $mapSize * $hillDensity * 0.2);
for ($i = 0; $i < $numHills; $i++) {
    $x = rand(0, $mapSize - 1);
    $z = rand(0, $mapSize - 1);
    $height = rand(1, $hillHeight);
    for ($y = 0; $y < $height; $y++) {
        $result[] = [
            'type' => 'hill',
            'position' => [$x - $mapSize / 2, 0.5 + $y, $z - $mapSize / 2],
            'rotation' => 0
        ];
    }
}

// Generate lakes
for ($i = 0; $i < $lakeCount; $i++) {
    $centerX = rand(10, $mapSize - 10);
    $centerZ = rand(10, $mapSize - 10);
    $radius = rand(3, 6);
    for ($x = -$radius; $x <= $radius; $x++) {
        for ($z = -$radius; $z <= $radius; $z++) {
            if ($x*$x + $z*$z <= $radius*$radius) {
                $result[] = [
                    'type' => 'water',
                    'position' => [$centerX + $x - $mapSize / 2, 0.01, $centerZ + $z - $mapSize / 2],
                    'rotation' => 0
                ];
            }
        }
    }
}

// Generate rivers (simple straight lines)
for ($i = 0; $i < $riverCount; $i++) {
    $startX = rand(0, $mapSize - 1);
    for ($z = 0; $z < $mapSize; $z++) {
        $result[] = [
            'type' => 'water',
            'position' => [$startX - $mapSize / 2, 0.01, $z - $mapSize / 2],
            'rotation' => 0
        ];
    }
}

// Return JSON
echo json_encode($result, JSON_PRETTY_PRINT);

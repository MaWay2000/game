<?php
// load_map.php

header('Content-Type: application/json');

// Define the map data file
$file = 'saved_map.json';

// Check if file exists
if (!file_exists($file)) {
    http_response_code(404); // Not Found
    exit(json_encode(['status' => 'error', 'message' => 'No saved map found.']));
}

// Load and return the map data
$data = file_get_contents($file);
echo $data;

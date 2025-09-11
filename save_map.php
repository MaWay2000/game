<?php
// save_map.php

// Ensure the request is POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    exit(json_encode(['status' => 'error', 'message' => 'Invalid request method.']));
}

// Get the input JSON
$inputJSON = file_get_contents('php://input');
$data = json_decode($inputJSON, true);

// Validate the JSON
if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
    http_response_code(400); // Bad Request
    exit(json_encode(['status' => 'error', 'message' => 'Invalid JSON data.']));
}

// Define the file to save the map data
$file = 'saved_map.json';

// Save JSON data into file
if (file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT))) {
    echo json_encode(['status' => 'success', 'message' => 'Map saved successfully!']);
} else {
    http_response_code(500); // Internal Server Error
    echo json_encode(['status' => 'error', 'message' => 'Failed to save map data.']);
}

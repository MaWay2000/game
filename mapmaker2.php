<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Map Maker</title>
    <style>
        body { margin: 0; overflow: hidden; }
        #sidebar {
            position: absolute;
            top: 0;
            left: 0;
            width: 250px;
            height: 100%;
            background: #333;
            color: #fff;
            padding: 15px;
            overflow-y: auto;
        }
        #editorCanvas {
            position: absolute;
            top: 0;
            left: 250px;
            width: calc(100% - 250px); /* Adjust width to leave space for sidebar */
            height: 100%;
        }
        .button {
            display: block;
            margin: 10px 0;
            padding: 10px;
            background: #444;
            color: #fff;
            border: none;
            cursor: pointer;
        }
        .button:hover {
            background: #555;
        }
    </style>
</head>
<body>
    <div id="sidebar">
        <h2>Map Maker</h2>
        <label for="objectSelect">Select Object:</label>
        <select id="objectSelect" onchange="updateSelectedObject()">
            <option value="wall">Wall</option>
            <option value="terrain">Terrain</option>
            <!-- Add more object options as needed -->
        </select>
        <button class="button" onclick="addSelectedObject()">Add Selected Object</button>
        <button class="button" onclick="removeObject()">Remove Object</button>
        <button class="button" onclick="saveMap()">Save Map *not done</button>
        <label for="objectSelect"><hr></label>
        <label for="objectSelect"><b>View controls:</b></label> 
        <br>       
        <label for="objectSelect">Zoom in/out - use mouse whell</label>
        <br>
        <label for="objectSelect">To move around - Use "WASD"</label>
        <br>
        <label for="objectSelect">Hold "mouse right to rotate view</label>
        <br>
        <label for="objectSelect">Move object - use arrows</label>
                
        <br>
        <label for="objectSelect"><hr></label>
        <br>        
        <label for="objectSelect"><b>Building controls:</b></label>
        <br>
        <label for="objectSelect">Place object - space</label>
        <br>   
        <label for="objectSelect">C - magic create</label>
        <br>          
        
    </div>
    

    <script src="js/three.min.js"></script>
    <script src="js/mapmaker.js"></script>
</body>
</html>

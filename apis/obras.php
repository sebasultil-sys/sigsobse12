<?php
header("Content-Type: application/json");
http_response_code(410);

echo json_encode([
    "ok" => false,
    "error" => "Endpoint PHP retirado. Usa la API Node.js del backend GIS.",
]);

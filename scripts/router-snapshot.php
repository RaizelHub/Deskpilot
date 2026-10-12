<?php

// Offline inspection only: no router credentials, network calls or database writes.
require __DIR__.'/../apps/server/vendor/autoload.php';

if ($argc !== 2 || ! is_file($argv[1]) || filesize($argv[1]) > 1048576) {
    fwrite(STDERR, "Usage: php scripts/router-snapshot.php <saved-LAN-response.html> (max 1 MiB)\n");
    exit(1);
}
try {
    $html = file_get_contents($argv[1]);
    if ($html === false) {
        throw new RuntimeException('Unable to read the saved response.');
    }
    echo json_encode((new App\Services\SkyworthDeviceSnapshot)->parse($html), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage().PHP_EOL);
    exit(1);
}

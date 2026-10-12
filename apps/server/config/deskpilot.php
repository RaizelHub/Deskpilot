<?php

return [
    'webhook_allow_loopback_http' => (bool) env('WEBHOOK_ALLOW_LOOPBACK_HTTP', false),
    'frontend_url' => env('FRONTEND_URL', 'http://localhost:5173'),
    'offline_seconds' => max(120, (int) env('AGENT_OFFLINE_SECONDS', 180)),
    'agent_allow_loopback_http' => (bool) env('AGENT_ALLOW_LOOPBACK_HTTP', false),
];

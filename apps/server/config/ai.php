<?php

return [
    'enabled' => (bool) env('AI_ENABLED', false),
    'provider' => env('AI_PROVIDER', 'groq'),
    'model' => env('AI_MODEL', ''),
    'groq_key' => env('GROQ_API_KEY', ''),
    'gemini_key' => env('GEMINI_API_KEY', ''),
    'daily_limit' => max(1, min(500, (int) env('AI_DAILY_LIMIT', 100))),
];

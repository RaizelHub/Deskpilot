<?php
// Only the isolated browser harness may load this deterministic provider fixture.
if (getenv('DESKPILOT_AI_BROWSER_FIXTURE') !== '1' || getenv('DB_DATABASE') !== 'deskpilot_browser_test' || getenv('APP_ENV') !== 'local') {
    fwrite(STDERR, "Refusing to run AI fixture outside the disposable browser database.\n");
    exit(1);
}
require __DIR__.'/../apps/server/vendor/autoload.php';
$app = require __DIR__.'/../apps/server/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (Illuminate\Support\Facades\DB::connection()->getDatabaseName() !== 'deskpilot_browser_test') { exit(1); }
Illuminate\Support\Facades\Http::preventStrayRequests();
Illuminate\Support\Facades\Http::fake(['api.groq.com/*' => function ($request) {
    $context = json_decode($request['messages'][1]['content'], true, 32, JSON_THROW_ON_ERROR);
    $result = ['summary' => '[Test fixture] The ticket reports DNS resolution failures.', 'category_id' => $context['categories'][0]['id'], 'priority' => 'medium', 'likely_cause' => 'DNS resolution may be failing; this is not a confirmed diagnosis.', 'diagnostic_interpretation' => 'No diagnostic result was included.', 'steps' => ['Check whether other websites are affected.', 'Run the approved DNS diagnostic and compare the result with the gateway test.'], 'diagnostic_commands' => ['network.test_dns'], 'article_ids' => array_column($context['articles'], 'id'), 'limitations' => ['Controlled browser-test response, not a live AI result.']];
    return Illuminate\Support\Facades\Http::response(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => json_encode($result)]]]]);
}]);
exit(Illuminate\Support\Facades\Artisan::call('queue:work', ['--once' => true, '--tries' => 1, '--timeout' => 50]));

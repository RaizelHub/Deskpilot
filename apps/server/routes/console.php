<?php

use App\Services\AiService;
use App\Services\DiagnosticService;
use App\Services\MonitoringService;
use App\Services\RemoteSupportService;
use App\Services\WebhookDeliveryService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Schedule::call(fn () => DB::table('agent_nonces')->where('created_at', '<', now()->subMinutes(10))->delete())->everyFiveMinutes()->name('prune-agent-nonces')->withoutOverlapping();
Schedule::call(fn () => app(DiagnosticService::class)->sweep())->everyMinute()->name('expire-diagnostic-commands')->withoutOverlapping();

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('monitoring:evaluate', function () {
    app(MonitoringService::class)->sweep();
    $this->info('Monitoring evaluation complete.');
})->purpose('Evaluate device health and deduplicated incidents');
Schedule::command('monitoring:evaluate')->everyMinute()->withoutOverlapping();

Schedule::call(fn () => app(RemoteSupportService::class)->sweep())->everyMinute()->name('expire-remote-support')->withoutOverlapping();

Artisan::command('automation:dispatch', function () {
    $count = app(WebhookDeliveryService::class)->dispatchDue();
    $this->info("Queued {$count} webhook deliveries.");
})->purpose('Dispatch due durable webhook deliveries');
Schedule::command('automation:dispatch')->everyMinute()->withoutOverlapping();

Schedule::call(fn () => app(AiService::class)->expire())->everyMinute()->name('expire-ai-analysis')->withoutOverlapping();

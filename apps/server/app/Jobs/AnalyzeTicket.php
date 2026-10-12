<?php

namespace App\Jobs;

use App\Services\AiService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class AnalyzeTicket implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 50;

    public function __construct(public string $runId) {}

    public function handle(AiService $service): void
    {
        $service->perform($this->runId);
    }

    public function failed(?\Throwable $e): void
    {
        app(AiService::class)->finish($this->runId, 'worker_failed');
    }
}

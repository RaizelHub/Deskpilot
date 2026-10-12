<?php

namespace App\Jobs;

use App\Services\WebhookDeliveryService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class DeliverWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 20;

    public function __construct(public string $deliveryId) {}

    public function handle(WebhookDeliveryService $service): void
    {
        $service->deliver($this->deliveryId);
    }
}

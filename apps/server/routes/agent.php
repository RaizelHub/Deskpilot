<?php

use App\Http\Controllers\AgentController;
use App\Http\Controllers\DiagnosticController;
use App\Http\Controllers\RemoteSupportController;
use App\Http\Controllers\SoftwareInventoryController;
use Illuminate\Support\Facades\Route;

Route::middleware('agent.transport')->group(function () {
    Route::post('enroll', [AgentController::class, 'enroll'])->middleware('throttle:agent-enrollment');
    Route::middleware(['throttle:agent-reports', 'agent.signature'])->group(function () {
        Route::post('commands/claim', [DiagnosticController::class, 'claim']);
        Route::post('commands/{command}/start', [DiagnosticController::class, 'start'])->whereUuid('command');
        Route::post('commands/{command}/result', [DiagnosticController::class, 'result'])->whereUuid('command');
        Route::post('remote-support/poll', [RemoteSupportController::class, 'poll']);
        Route::post('heartbeat', [AgentController::class, 'heartbeat']);
        Route::post('software-inventory', [SoftwareInventoryController::class, 'ingest']);
        Route::post('inventory', [AgentController::class, 'inventory']);
    });
});

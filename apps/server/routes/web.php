<?php

use App\Http\Controllers\AiController;
use App\Http\Controllers\AssetController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\AutomationController;
use App\Http\Controllers\DepartmentController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\DiagnosticController;
use App\Http\Controllers\KnowledgeController;
use App\Http\Controllers\MonitoringController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\RemoteSupportController;
use App\Http\Controllers\SlaPolicyController;
use App\Http\Controllers\SoftwareInventoryController;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Route;

// These first-party API routes intentionally use web/session + CSRF middleware.
Route::prefix('api/v1')->group(function () {
    Route::get('auth/csrf', fn () => response()->noContent());
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
    Route::post('auth/forgot-password', [AuthController::class, 'forgot'])->middleware('throttle:passwords');
    Route::post('auth/reset-password', [AuthController::class, 'reset'])->middleware('throttle:passwords');
    Route::middleware(['auth', 'auth.session', 'active'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::post('auth/password', [AuthController::class, 'password'])->middleware('throttle:passwords');
        Route::post('auth/verification-notification', [AuthController::class, 'resend'])->middleware('throttle:6,1');
        Route::get('auth/verify-email/{id}/{hash}', [AuthController::class, 'verify'])->middleware(['signed', 'throttle:6,1'])->name('verification.verify');
        Route::middleware('verified')->group(function () {
            Route::middleware('permission:knowledge.view')->group(function () {
                Route::get('knowledge-categories', [KnowledgeController::class, 'categories']);
                Route::get('knowledge', [KnowledgeController::class, 'index']);
                Route::get('knowledge/{article}', [KnowledgeController::class, 'show'])->whereUuid('article');
                Route::post('knowledge', [KnowledgeController::class, 'save'])->middleware(['permission:knowledge.manage', 'throttle:20,1']);
                Route::patch('knowledge/{article}', [KnowledgeController::class, 'save'])->whereUuid('article')->middleware('permission:knowledge.manage');
            });
            Route::prefix('tickets/{ticket}/ai')->whereUuid('ticket')->middleware(['permission:tickets.view', 'permission:ai.use'])->group(function () {
                Route::get('', [AiController::class, 'index']);
                Route::post('preview', [AiController::class, 'preview'])->middleware('throttle:ai-preview');
                Route::post('', [AiController::class, 'request'])->middleware('throttle:ai-request');
            });

            Route::get('notifications', [NotificationController::class, 'index']);
            Route::post('notifications/read-all', [NotificationController::class, 'readAll']);
            Route::post('notifications/{notification}/read', [NotificationController::class, 'read'])->whereUuid('notification');
            Route::middleware('permission:automation.view')->group(function () {
                Route::get('automation', [AutomationController::class, 'index']);
                Route::get('webhook-deliveries', [AutomationController::class, 'deliveries']);
                Route::get('webhook-deliveries/{delivery}', [AutomationController::class, 'show'])->whereUuid('delivery');
                Route::middleware('permission:automation.manage')->group(function () {
                    Route::post('webhooks', [AutomationController::class, 'save'])->middleware('throttle:10,1');
                    Route::patch('webhooks/{webhook}', [AutomationController::class, 'save'])->whereUuid('webhook');
                    Route::post('webhooks/{webhook}/rotate', [AutomationController::class, 'rotate'])->whereUuid('webhook')->middleware('throttle:10,1');
                    Route::post('webhooks/{webhook}/test', [AutomationController::class, 'test'])->whereUuid('webhook')->middleware('throttle:10,1');
                    Route::post('webhook-deliveries/{delivery}/retry', [AutomationController::class, 'retry'])->whereUuid('delivery')->middleware('throttle:10,1');
                    Route::post('notification-rules', [AutomationController::class, 'rule'])->middleware('throttle:20,1');
                    Route::patch('notification-rules/{rule}', [AutomationController::class, 'rule'])->whereUuid('rule');
                });
            });
            Route::middleware('permission:assets.view')->group(function () {
                Route::get('assets', [AssetController::class, 'index']);
                Route::get('asset-statistics', [AssetController::class, 'stats']);
                Route::get('assets/{asset}', [AssetController::class, 'show'])->whereUuid('asset');
                Route::get('assets/{asset}/history', [AssetController::class, 'history'])->whereUuid('asset');
                Route::get('assets/{asset}/assignments', [AssetController::class, 'assignments'])->whereUuid('asset');
                Route::middleware('permission:assets.manage')->group(function () {
                    Route::get('asset-options', [AssetController::class, 'options']);
                    Route::post('assets', [AssetController::class, 'save'])->middleware('throttle:30,1');
                    Route::patch('assets/{asset}', [AssetController::class, 'save'])->whereUuid('asset');
                    Route::post('assets/{asset}/assign', [AssetController::class, 'assign'])->whereUuid('asset');
                    Route::post('assets/{asset}/return', [AssetController::class, 'returnAsset'])->whereUuid('asset');
                });
                Route::middleware('permission:devices.view')->group(function () {
                    Route::get('software-inventory', [SoftwareInventoryController::class, 'index']);
                    Route::get('software-coverage', [SoftwareInventoryController::class, 'coverage']);
                });
            });
            Route::get('remote-support/capabilities', [RemoteSupportController::class, 'capabilities']);
            Route::get('my-support-requests', [RemoteSupportController::class, 'index'])->name('remote.mine');
            Route::middleware(['permission:remote.request', 'permission:devices.view'])->group(function () {
                Route::get('remote-sessions', [RemoteSupportController::class, 'index']);
                Route::post('remote-sessions', [RemoteSupportController::class, 'create'])->middleware('throttle:10,1');
            });
            Route::get('remote-sessions/{session}', [RemoteSupportController::class, 'show'])->whereUuid('session');
            Route::post('remote-sessions/{session}/actions', [RemoteSupportController::class, 'action'])->whereUuid('session')->middleware('throttle:20,1');
            Route::middleware(['permission:devices.view', 'permission:devices.diagnostics'])->group(function () {
                Route::get('diagnostic-catalog', [DiagnosticController::class, 'catalog']);
                Route::get('devices/{device}/diagnostics', [DiagnosticController::class, 'index'])->whereUuid('device');
                Route::post('devices/{device}/diagnostics', [DiagnosticController::class, 'create'])->whereUuid('device')->middleware('throttle:20,1');
                Route::post('devices/{device}/diagnostics/{command}/cancel', [DiagnosticController::class, 'cancel'])->whereUuid(['device', 'command']);
            });
            Route::middleware('permission:devices.view')->group(function () {
                Route::get('devices', [DeviceController::class, 'index']);
                Route::get('device-statistics', [DeviceController::class, 'stats']);
                Route::get('devices/{device}', [DeviceController::class, 'show'])->whereUuid('device');
            });
            Route::middleware('permission:devices.manage')->group(function () {
                Route::patch('devices/{device}', [DeviceController::class, 'update'])->whereUuid('device');
                Route::post('devices/{device}/revoke', [DeviceController::class, 'revoke'])->whereUuid('device');
                Route::get('enrollment-grants', [DeviceController::class, 'grants']);
                Route::post('enrollment-grants', [DeviceController::class, 'createGrant'])->middleware('throttle:10,1');
                Route::delete('enrollment-grants/{grant}', [DeviceController::class, 'revokeGrant'])->whereUuid('grant');
            });
            Route::middleware('permission:tickets.view')->group(function () {
                Route::get('ticket-options', [TicketController::class, 'options']);
                Route::get('ticket-people', [TicketController::class, 'people']);
                Route::get('tickets', [TicketController::class, 'index']);
                Route::post('tickets', [TicketController::class, 'store'])->middleware(['permission:tickets.create', 'throttle:30,1']);
                Route::post('tickets/bulk', [TicketController::class, 'bulk'])->middleware('throttle:20,1');
                Route::prefix('tickets/{ticket}')->whereUuid('ticket')->group(function () {
                    Route::get('', [TicketController::class, 'show']);
                    Route::patch('', [TicketController::class, 'update']);
                    Route::post('reopen', [TicketController::class, 'reopen']);
                    Route::get('comments', [TicketController::class, 'comments']);
                    Route::post('comments', [TicketController::class, 'comment'])->middleware('throttle:30,1');
                    Route::get('history', [TicketController::class, 'history']);
                    Route::get('attachments', [TicketController::class, 'attachments']);
                    Route::post('attachments', [TicketController::class, 'upload'])->middleware('throttle:10,1');
                    Route::get('attachments/{attachment}', [TicketController::class, 'download'])->whereUuid('attachment');
                    Route::delete('attachments/{attachment}', [TicketController::class, 'deleteAttachment'])->whereUuid('attachment');
                });
            });
            Route::get('sla-policies', [SlaPolicyController::class, 'index'])->middleware('permission:settings.manage');
            Route::put('sla-policies', [SlaPolicyController::class, 'update'])->middleware('permission:settings.manage');
            Route::middleware('permission:monitoring.view')->group(function () {
                Route::get('alerts', [MonitoringController::class, 'index']);
                Route::get('monitoring-statistics', [MonitoringController::class, 'stats']);
                Route::get('devices/{device}/health', [MonitoringController::class, 'health'])->whereUuid('device')->middleware('permission:devices.view');
                Route::post('alerts/{alert}/acknowledge', [MonitoringController::class, 'acknowledge'])->whereUuid('alert')->middleware('permission:monitoring.acknowledge');
                Route::get('alert-rules', [MonitoringController::class, 'rules']);
                Route::put('alert-rules/{kind}', [MonitoringController::class, 'updateRule'])->middleware('permission:monitoring.manage');
            });
            Route::get('dashboard', [WorkspaceController::class, 'dashboard'])->middleware('permission:dashboard.view');
            Route::get('users', [UserController::class, 'index'])->middleware('permission:users.view');
            Route::post('users', [UserController::class, 'store'])->middleware('permission:users.manage');
            Route::post('users/bulk-status', [UserController::class, 'bulkStatus'])->middleware('permission:users.manage');
            Route::patch('users/{user}', [UserController::class, 'update'])->middleware('permission:users.manage')->whereUuid('user');
            Route::get('roles', [WorkspaceController::class, 'roles'])->middleware('permission:roles.view');
            Route::get('departments', [DepartmentController::class, 'index'])->middleware('permission:departments.view');
            Route::post('departments', [DepartmentController::class, 'store'])->middleware('permission:departments.manage');
            Route::patch('departments/{department}', [DepartmentController::class, 'update'])->middleware('permission:departments.manage')->whereUuid('department');
            Route::delete('departments/{department}', [DepartmentController::class, 'destroy'])->middleware('permission:departments.manage')->whereUuid('department');
            Route::get('audit-logs', [WorkspaceController::class, 'audit'])->middleware('permission:audit.view');
        });
    });
});

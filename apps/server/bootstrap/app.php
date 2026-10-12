<?php

use App\Http\Middleware\ActiveUser;
use App\Http\Middleware\AgentSignature;
use App\Http\Middleware\AgentTransport;
use App\Http\Middleware\RequirePermission;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/agent.php',
        apiPrefix: 'api/v1/agent',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'active' => ActiveUser::class,
            'agent.transport' => AgentTransport::class,
            'agent.signature' => AgentSignature::class,
            'permission' => RequirePermission::class,
        ]);
        $middleware->redirectGuestsTo(fn () => '/login');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn ($request) => $request->is('api/*') || $request->expectsJson());
    })->create();

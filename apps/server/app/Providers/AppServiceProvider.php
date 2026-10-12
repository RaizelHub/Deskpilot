<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('ai-preview', fn (Request $request) => Limit::perMinute(15)->by('ai-preview|'.$request->user()->id));
        RateLimiter::for('ai-request', fn (Request $request) => Limit::perMinute(3)->by('ai-request|'.$request->user()->id));
        RateLimiter::for('agent-enrollment', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));
        RateLimiter::for('agent-reports', fn (Request $request) => [Limit::perMinute(30)->by($request->ip().'|'.substr($request->header('X-Device-Id', ''), 0, 36)), Limit::perMinute(3000)->by($request->ip())]);
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(30)->by('ip|'.$request->ip()),
        ]);
        RateLimiter::for('passwords', fn (Request $request) => Limit::perMinute(5)->by($request->ip()));
        ResetPassword::createUrlUsing(fn ($user, $token) => config('deskpilot.frontend_url').'/reset-password?'.http_build_query(['token' => $token, 'email' => $user->email]));
        VerifyEmail::createUrlUsing(function ($user) {
            $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), ['id' => $user->id, 'hash' => sha1($user->getEmailForVerification())]);

            return config('deskpilot.frontend_url').'/verify-email?'.http_build_query(['url' => $url]);
        });
    }
}

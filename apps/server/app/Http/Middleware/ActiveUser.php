<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class ActiveUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $version = $request->user()?->auth_version;
        if (! $request->user()?->is_active || $request->session()->get('auth_version', $version) !== $version) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            abort(401, 'This session is no longer active. Sign in again or contact your administrator.');
        }
        $request->session()->put('auth_version', $version);

        return $next($request);
    }
}

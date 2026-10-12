<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class AgentTransport
{
    public function handle(Request $request, Closure $next)
    {
        $local = config('deskpilot.agent_allow_loopback_http') && app()->environment('local', 'testing') && in_array($request->ip(), ['127.0.0.1', '::1'], true) && in_array($request->getHost(), ['127.0.0.1', 'localhost', '[::1]', '::1'], true);
        abort_unless($request->isSecure() || $local, 403, 'Agent connections require HTTPS.');
        abort_if(strlen($request->getContent()) > 262144, 413, 'Agent report exceeds 256 KiB.');
        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}

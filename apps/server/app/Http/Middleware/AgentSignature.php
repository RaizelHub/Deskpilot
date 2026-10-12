<?php

namespace App\Http\Middleware;

use App\Models\Device;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AgentSignature
{
    public function handle(Request $request, Closure $next)
    {
        $id = $request->header('X-Device-Id', '');
        $timestamp = $request->header('X-Agent-Time', '');
        $nonce = $request->header('X-Agent-Nonce', '');
        $signature = base64_decode($request->header('X-Agent-Signature', ''), true);
        abort_unless(Str::isUuid($id) && Str::isUuid($nonce) && ctype_digit($timestamp) && abs(now()->timestamp - (int) $timestamp) <= 300 && $signature !== false && strlen($signature) <= 1024, 401, 'Invalid device signature.');
        abort_if($request->getQueryString() !== null, 400, 'Agent routes do not accept query parameters.');

        return DB::transaction(function () use ($request, $next, $id, $timestamp, $nonce, $signature) {
            $device = Device::whereKey($id)->lockForUpdate()->first();
            abort_unless($device && ! $device->revoked_at, 401, 'Device identity is unavailable or revoked.');
            $credential = $device->credential;
            abort_unless($credential && ! $credential->revoked_at, 401, 'Device identity is unavailable or revoked.');
            $canonical = implode("\n", ['v1', $request->method(), $request->getPathInfo(), $id, $timestamp, $nonce, hash('sha256', $request->getContent())]);
            abort_unless(openssl_verify($canonical, $signature, $credential->public_key, OPENSSL_ALGO_SHA256) === 1, 401, 'Invalid device signature.');
            $inserted = DB::table('agent_nonces')->insertOrIgnore(['device_id' => $id, 'nonce' => $nonce, 'created_at' => now()]);
            abort_unless($inserted, 409, 'This agent request has already been received.');
            $request->attributes->set('device',$device);

            return $next($request);
        });
    }
}

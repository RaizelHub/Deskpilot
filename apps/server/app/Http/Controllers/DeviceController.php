<?php

namespace App\Http\Controllers;

use App\Http\Resources\DeviceResource;
use App\Models\Device;
use App\Models\EnrollmentGrant;
use App\Services\Audit;
use App\Services\DiagnosticService;
use App\Services\RemoteSupportService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DeviceController extends Controller
{
    public function index(Request $r)
    {
        $d = $r->validate(['search' => 'nullable|string|max:100', 'state' => ['nullable', Rule::in(['online', 'offline', 'pending', 'revoked'])], 'page' => 'integer|min:1', 'department_id' => 'nullable|uuid']);
        $q = Device::with(['department:id,name', 'hardware']);
        if ($s = $d['search'] ?? null) {
            $q->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.strtolower($s).'%'])->orWhereRaw('LOWER(hostname) LIKE ?', ['%'.strtolower($s).'%']));
        }
        if ($d['department_id'] ?? null) {
            $q->where('department_id', $d['department_id']);
        }$cutoff = now()->subSeconds(config('deskpilot.offline_seconds'));
        switch ($d['state'] ?? '') {
            case 'revoked':$q->whereNotNull('revoked_at');
                break;
            case 'pending':$q->whereNull('revoked_at')->whereNull('last_seen_at');
                break;
            case 'online':$q->whereNull('revoked_at')->where('last_seen_at', '>=', $cutoff);
                break;
            case 'offline':$q->whereNull('revoked_at')->whereNotNull('last_seen_at')->where('last_seen_at', '<', $cutoff);
                break;
        }

        return DeviceResource::collection($q->orderBy('name')->orderBy('id')->paginate(15));
    }

    public function stats()
    {
        $cutoff = now()->subSeconds(config('deskpilot.offline_seconds'));

        return response()->json(['total' => Device::count(), 'online' => Device::whereNull('revoked_at')->where('last_seen_at', '>=', $cutoff)->count(), 'offline' => Device::whereNull('revoked_at')->whereNotNull('last_seen_at')->where('last_seen_at', '<', $cutoff)->count(), 'pending' => Device::whereNull('revoked_at')->whereNull('last_seen_at')->count(), 'revoked' => Device::whereNotNull('revoked_at')->count(), 'offline_seconds' => config('deskpilot.offline_seconds')]);
    }

    public function show(string $device)
    {
        return new DeviceResource(Device::with(['department:id,name', 'hardware', 'disks', 'interfaces'])->findOrFail($device));
    }

    public function update(Request $r, string $device, Audit $audit)
    {
        $d = $r->validate(['name' => 'required|string|max:100', 'department_id' => 'nullable|uuid|exists:departments,id', 'version' => 'required|integer|min:1']);

        return DB::transaction(function () use ($d, $device, $r, $audit) {
            $m = Device::whereKey($device)->lockForUpdate()->firstOrFail();
            abort_if($m->version !== $d['version'], 409, 'Device details changed. Refresh and try again.');
            $m->update(['name' => $d['name'], 'department_id' => $d['department_id'] ?? null, 'version' => $m->version + 1]);
            $audit->record('device.updated', $r->user(), $m);

            return new DeviceResource($m->load('department:id,name'));
        });
    }

    public function revoke(Request $r, string $device, Audit $audit)
    {
        $d = $r->validate(['reason' => 'required|string|min:3|max:500']);

        return DB::transaction(function () use ($d, $device, $r, $audit) {
            $m = Device::whereKey($device)->lockForUpdate()->firstOrFail();
            if (! $m->revoked_at) {
                $m->update(['revoked_at' => now(), 'revocation_reason' => $d['reason'], 'version' => $m->version + 1]);
                $m->credential()->update(['revoked_at' => now()]);
                app(DiagnosticService::class)->revoke($m, $r->user());
                app(RemoteSupportService::class)->reconcile($m);
                $audit->record('device.revoked', $r->user(), $m, ['reason' => $d['reason']]);
            }

            return response()->json(['message' => 'Device identity revoked. Reports from this key are now rejected.']);
        });
    }

    public function grants(Request $r)
    {
        $r->validate(['page' => 'integer|min:1']);

        return EnrollmentGrant::latest()->orderBy('id')->paginate(15);
    }

    public function createGrant(Request $r, Audit $audit)
    {
        $d = $r->validate(['label' => 'required|string|min:2|max:100', 'department_id' => 'nullable|uuid|exists:departments,id', 'expires_minutes' => 'required|integer|min:5|max:1440']);
        $token = bin2hex(random_bytes(32));
        $grant = EnrollmentGrant::create(['label' => $d['label'], 'department_id' => $d['department_id'] ?? null, 'created_by' => $r->user()->id, 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addMinutes($d['expires_minutes'])]);
        $audit->record('device.enrollment_grant_created', $r->user(), $grant);

        return response()->json(['data' => $grant, 'token' => $token], 201)->header('Cache-Control', 'no-store');
    }

    public function revokeGrant(Request $r, string $grant, Audit $audit)
    {
        DB::transaction(function () use ($r, $grant, $audit) {
            $m = EnrollmentGrant::whereKey($grant)->lockForUpdate()->firstOrFail();
            $m->update(['revoked_at' => now()]);
            $audit->record('device.enrollment_grant_revoked', $r->user(), $m);
        });

        return response()->noContent();
    }
}

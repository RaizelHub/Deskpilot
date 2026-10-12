<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\DeviceCommand;
use App\Services\DiagnosticService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DiagnosticController extends Controller
{
    public function catalog()
    {
        return response()->json(['data' => collect(DiagnosticService::CATALOG)->map(fn ($v, $key) => ['command' => $key] + $v)->values()]);
    }

    public function index(Request $r, string $device, DiagnosticService $service)
    {
        $r->validate(['page' => 'integer|min:1']);
        DB::transaction(function () use ($device, $service) {
            $d = Device::whereKey($device)->lockForUpdate()->firstOrFail();
            $service->expire($d);
        });

        return DeviceCommand::where('device_id', $device)->with('requester:id,name')->latest()->orderByDesc('id')->paginate(10);
    }

    public function create(Request $r, string $device, DiagnosticService $service)
    {
        abort_if(array_diff(array_keys($r->all()), ['command', 'reason', 'ticket_id', 'request_key']), 422, 'Only the approved command ID, reason, ticket and request key are accepted.');
        $d = $r->validate(['command' => ['required', Rule::in(array_keys(DiagnosticService::CATALOG))], 'reason' => 'required|string|min:3|max:500', 'ticket_id' => 'nullable|uuid', 'request_key' => 'required|uuid']);

        return response()->json(['data' => $service->request($r->user(), $device, $d, $r->ip())->load('requester:id,name')], 201);
    }

    public function cancel(Request $r, string $device, string $command, DiagnosticService $service)
    {
        $service->cancel($r->user(), $device, $command);

        return response()->noContent();
    }

    public function claim(Request $r, DiagnosticService $service)
    {
        abort_if(count($r->all()) > 0, 422, 'Command polling accepts no parameters.');

        return response()->json(['data' => $service->claim($r->attributes->get('device'))]);
    }

    public function start(Request $r, string $command, DiagnosticService $service)
    {
        $d = $r->validate(['lease_id' => 'required|uuid']);
        $c = $service->start($r->attributes->get('device'), $command, $d['lease_id']);

        return response()->json(['status' => $c->status]);
    }

    public function result(Request $r, string $command, DiagnosticService $service)
    {
        $d = $r->validate(['lease_id' => 'required|uuid', 'status' => ['required', Rule::in(['succeeded', 'failed', 'rejected'])], 'summary' => 'required|string|max:1000', 'duration_ms' => 'required|integer|min:0|max:60000', 'checks' => 'present|array|max:64', 'checks.*' => 'array:name,status,detail,duration_ms', 'checks.*.name' => 'required|string|max:120', 'checks.*.status' => ['required', Rule::in(['pass', 'fail', 'warning', 'info'])], 'checks.*.detail' => 'required|string|max:2000', 'checks.*.duration_ms' => 'sometimes|nullable|integer|min:0|max:60000']);
        $c = $service->result($r->attributes->get('device'), $command, $d);

        return response()->json(['status' => $c->status]);
    }
}

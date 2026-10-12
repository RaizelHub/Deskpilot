<?php

namespace App\Http\Controllers;

use App\Models\AlertRule;
use App\Models\Device;
use App\Models\DeviceAlert;
use App\Services\Audit;
use App\Services\MonitoringService;
use App\Services\TicketAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MonitoringController extends Controller
{
    public function index(Request $r)
    {
        $d = $r->validate(['status' => ['nullable', Rule::in(['active', 'open', 'acknowledged', 'recovered', 'closed', 'all'])], 'kind' => ['nullable', Rule::in(['offline', 'disk', 'cpu', 'memory'])], 'severity' => ['nullable', Rule::in(['warning', 'critical'])], 'device_id' => 'nullable|uuid', 'page' => 'integer|min:1']);
        $q = DeviceAlert::with(['device:id,name,hostname', 'acknowledger:id,name']);
        $status = $d['status'] ?? 'active';
        if ($status === 'active') {
            $q->whereIn('status', DeviceAlert::ACTIVE);
        } elseif ($status !== 'all') {
            $q->where('status', $status);
        }
        foreach (['kind', 'severity', 'device_id'] as $key) {
            if ($d[$key] ?? null) {
                $q->where($key, $d[$key]);
            }
        }
        $p = $q->orderByDesc('opened_at')->orderByDesc('id')->paginate(15);
        $visible = app(TicketAccess::class)->query($r->user())->whereIn('id', $p->pluck('ticket_id')->filter())->get(['id', 'number', 'status'])->keyBy('id');
        $p->getCollection()->transform(function ($alert) use ($visible) {
            $row = $alert->toArray();
            $row['ticket'] = $visible->get($alert->ticket_id);
            unset($row['ticket_id']);

            return $row;
        });

        return $p;
    }

    public function stats()
    {
        $completed = DB::table('monitor_runs')->where('name', 'devices')->value('completed_at');

        return response()->json(['active' => DeviceAlert::whereIn('status', DeviceAlert::ACTIVE)->count(), 'critical' => DeviceAlert::whereIn('status', DeviceAlert::ACTIVE)->where('severity', 'critical')->count(), 'acknowledged' => DeviceAlert::where('status', 'acknowledged')->count(), 'recovered_today' => DeviceAlert::where('status', 'recovered')->where('recovered_at', '>=', now()->startOfDay())->count(), 'evaluated_at' => $completed, 'stale' => ! $completed || Carbon::parse($completed)->lt(now()->subMinutes(3))]);
    }

    public function health(string $device, MonitoringService $service)
    {
        return response()->json($service->health(Device::with('hardware')->findOrFail($device)));
    }

    public function acknowledge(Request $r, string $alert, Audit $audit)
    {
        DB::transaction(function () use ($r, $alert, $audit) {
            $id = DeviceAlert::findOrFail($alert)->device_id;
            Device::whereKey($id)->lockForUpdate()->firstOrFail();
            $a = DeviceAlert::whereKey($alert)->lockForUpdate()->firstOrFail();
            abort_unless(in_array($a->status, DeviceAlert::ACTIVE, true), 409, 'Only active alerts can be acknowledged.');
            if ($a->status === 'open') {
                $a->update(['status' => 'acknowledged', 'acknowledged_by' => $r->user()->id, 'acknowledged_at' => now()]);
                $audit->record('alert.acknowledged', $r->user(), $a);
            }
        });

        return response()->noContent();
    }

    public function rules()
    {
        return response()->json(['data' => AlertRule::orderBy('kind')->get()]);
    }

    public function updateRule(Request $r, string $kind, Audit $audit)
    {
        abort_unless(in_array($kind, ['cpu', 'memory', 'disk', 'offline'], true), 404);
        $d = $r->validate(['enabled' => 'required|boolean', 'auto_incident' => 'required|boolean', 'warning' => $kind === 'offline' ? 'required|integer|min:120|max:86400' : 'required|integer|min:10|max:98', 'critical' => $kind === 'offline' ? 'prohibited' : 'required|integer|gt:warning|max:100', 'sustain_seconds' => $kind === 'offline' ? 'required|integer|in:0' : 'required|integer|min:0|max:3600', 'cooldown_seconds' => 'required|integer|min:60|max:86400', 'version' => 'required|integer|min:1']);

        return DB::transaction(function () use ($r, $d, $kind, $audit) {
            $rule = AlertRule::whereKey($kind)->lockForUpdate()->firstOrFail();
            abort_unless($rule->version === $d['version'], 409, 'This rule changed. Reload it before saving.');
            $rule->fill($d);
            $rule->version++;
            $rule->save();
            $audit->record('monitoring.rule_updated', $r->user(), null, $rule->toArray());

            return response()->json(['data' => $rule]);
        });
    }
}

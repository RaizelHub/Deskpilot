<?php

namespace App\Http\Controllers;

use App\Models\RemoteSession;
use App\Services\RemoteSupportService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RemoteSupportController extends Controller
{
    private const RELATIONS = ['device:id,name,hostname', 'technician:id,name', 'customer:id,name', 'ticket:id,number,title'];

    public function capabilities(RemoteSupportService $s)
    {
        return response()->json($s->capabilities());
    }

    public function index(Request $r)
    {
        $d = $r->validate(['page' => 'integer|min:1', 'status' => ['nullable', Rule::in(['pending', 'approved', 'finished', 'all'])]]);
        $q = RemoteSession::with(self::RELATIONS);
        if ($r->routeIs('remote.mine')) {
            $q->where('customer_id', $r->user()->id);
        } elseif (! $r->user()->hasPermission('devices.manage')) {
            $q->where('technician_id', $r->user()->id);
        }switch ($d['status'] ?? 'all') {
            case 'pending':$q->whereIn('status', ['requested', 'waiting_for_user']);
                break;
            case 'approved':$q->where('status', 'approved');
                break;
            case 'finished':$q->whereNotIn('status', RemoteSession::ACTIVE);
                break;
        }

        return $q->latest()->orderByDesc('id')->paginate(15);
    }

    public function show(Request $r, string $session, RemoteSupportService $service)
    {
        $s = RemoteSession::findOrFail($session);
        abort_unless($service->visible($r->user(), $s), 404);

        return response()->json(['data' => $s->load([...self::RELATIONS, 'events.actor:id,name']), 'capabilities' => $service->capabilities()]);
    }

    public function create(Request $r, RemoteSupportService $s)
    {
        abort_if(array_diff(array_keys($r->all()), ['device_id', 'ticket_id', 'mode', 'reason', 'request_key']), 422);
        $d = $r->validate(['device_id' => 'required|uuid', 'ticket_id' => 'required|uuid', 'mode' => ['required', Rule::in(['view', 'control'])], 'reason' => 'required|string|min:3|max:500', 'request_key' => 'required|uuid']);

        return response()->json(['data' => $s->request($r->user(), $d, $r->ip())->load(self::RELATIONS)], 201);
    }

    public function action(Request $r, string $session, RemoteSupportService $s)
    {
        abort_if(array_diff(array_keys($r->all()), ['action']), 422);
        $d = $r->validate(['action' => ['required', Rule::in(['viewed', 'view', 'control', 'decline', 'cancel'])]]);

        return response()->json(['data' => $s->action($r->user(), $session, $d['action'], $r->ip())->load([...self::RELATIONS, 'events.actor:id,name'])]);
    }

    public function poll(Request $r, RemoteSupportService $s)
    {
        abort_if(count($r->all()) > 0, 422);

        return response()->json(['data' => $s->poll($r->attributes->get('device'))]);
    }
}

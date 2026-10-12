<?php

namespace App\Http\Controllers;

use App\Models\AiRun;
use App\Models\DeviceCommand;
use App\Services\AiProvider;
use App\Services\AiService;
use App\Services\TicketAccess;
use Illuminate\Http\Request;

class AiController extends Controller
{
    public function index(Request $r, string $ticket, AiService $s)
    {
        $r->validate(['page' => 'integer|min:1']);
        $t = app(TicketAccess::class)->find($r->user(), $ticket);
        $runs = AiRun::where('ticket_id', $ticket)->where('requested_by', $r->user()->id)->latest()->orderByDesc('id')->paginate(5);
        $runs->getCollection()->transform(function ($run) use ($r, $s, $t) {
            $allowed = $s->permitted($r->user(), $run);

            return [...$run->toArray(), 'analysis' => $allowed ? $run->result : null, 'restricted' => ! $allowed, 'stale' => $run->ticket_version !== $t->version, 'sources' => $allowed ? $run->sources()->get(['knowledge_articles.id', 'title'])->map->only(['id', 'title']) : []];
        });
        $diagnostics = [];
        if ($r->user()->hasPermission('devices.view') && $r->user()->hasPermission('devices.diagnostics')) {
            $diagnostics = DeviceCommand::where('ticket_id', $ticket)->whereIn('status', ['succeeded', 'failed'])->whereNotNull('result')->latest()->limit(20)->get(['id', 'command', 'finished_at', 'status']);
        }

        return response()->json(['runs' => $runs, 'settings' => app(AiProvider::class)->settings(), 'diagnostics' => $diagnostics])->header('Cache-Control', 'no-store');
    }

    public function preview(Request $r, string $ticket, AiService $s)
    {
        $d = $r->validate(['diagnostic_id' => 'present|nullable|uuid']);

        return response()->json($s->preview($r->user(), $ticket, $d['diagnostic_id']))->header('Cache-Control', 'no-store');
    }

    public function request(Request $r, string $ticket, AiService $s)
    {
        $d = $r->validate(['token' => 'required|string|max:5000', 'request_key' => 'required|uuid']);

        return response()->json(['data' => $s->request($r->user(), $ticket, $d['token'], $d['request_key'])], 202)->header('Cache-Control', 'no-store');
    }
}

<?php

namespace App\Http\Controllers;

use App\Services\NotificationAccess;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $r, NotificationAccess $access)
    {
        $d = $r->validate(['page' => 'integer|min:1', 'unread' => 'nullable|boolean']);
        $q = $access->query($r->user());
        $count = (clone $q)->whereNull('read_at')->count();
        $result = $q->when($d['unread'] ?? false, fn ($q) => $q->whereNull('read_at'))->orderByDesc('created_at')->orderByDesc('id')->paginate(15);

        return response()->json([...$result->toArray(), 'unread_count' => $count]);
    }

    public function read(Request $r, string $notification, NotificationAccess $access)
    {
        $n = $access->query($r->user())->whereKey($notification)->firstOrFail();
        if (! $n->read_at) {
            $n->update(['read_at' => now()]);
        }

return response()->noContent();
    }

    public function readAll(Request $r, NotificationAccess $access)
    {
        $access->query($r->user())->whereNull('read_at')->update(['read_at' => now()]);

        return response()->noContent();
    }
}

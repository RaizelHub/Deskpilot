<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Role;
use App\Models\User;
use App\Services\TicketStatistics;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    public function dashboard(Request $request, TicketStatistics $tickets)
    {
        return response()->json([
            'tickets' => $tickets->for($request->user()),
            'users' => $request->user()->hasPermission('users.view') ? User::count() : null,
            'active_users' => $request->user()->hasPermission('users.view') ? User::where('is_active', true)->count() : null,
            'departments' => $request->user()->hasPermission('departments.view') ? Department::count() : null,
            'roles' => $request->user()->hasPermission('roles.view') ? Role::count() : null,
            'recent_activity' => $request->user()->hasPermission('audit.view') ? AuditLog::with('actor:id,name')->latest()->limit(8)->get() : [],
        ]);
    }

    public function roles(Request $request)
    {
        return response()->json(['data' => Role::with('permissions:id,name')->orderBy('name')->get()]);
    }

    public function audit(Request $request)
    {
        $data = $request->validate(['page' => 'integer|min:1', 'search' => 'nullable|string|max:100']);

        return AuditLog::with('actor:id,name')->when($data['search'] ?? null, fn ($q, $s) => $q->where('action', 'like', '%'.$s.'%'))->latest()->orderBy('id')->paginate(20);
    }
}

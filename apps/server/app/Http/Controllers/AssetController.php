<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Department;
use App\Models\Device;
use App\Models\User;
use App\Services\AssetService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AssetController extends Controller
{
    public function index(Request $r)
    {
        $d = $r->validate(['search' => 'nullable|string|max:100', 'category' => ['nullable', Rule::in(Asset::CATEGORIES)], 'status' => ['nullable', Rule::in(Asset::STATUSES)], 'warranty' => ['nullable', Rule::in(['unknown', 'expired', 'expiring', 'covered'])], 'sort' => ['nullable', Rule::in(['tag', 'name', 'warranty_expires_on', 'updated_at'])], 'direction' => ['nullable', Rule::in(['asc', 'desc'])], 'page' => 'integer|min:1', 'department_id' => 'nullable|uuid']);
        $q = Asset::with(Asset::RELATIONS);
        if ($s = $d['search'] ?? null) {
            $q->where(fn ($q) => $q->whereRaw('LOWER(tag) LIKE ?', ['%'.strtolower($s).'%'])->orWhereRaw('LOWER(name) LIKE ?', ['%'.strtolower($s).'%'])->orWhereRaw('LOWER(serial_number) LIKE ?', ['%'.strtolower($s).'%']));
        }
        foreach (['category', 'status', 'department_id'] as $f) {
            if ($d[$f] ?? null) {
                $q->where($f, $d[$f]);
            }
        }
        switch ($d['warranty'] ?? '') {
            case 'unknown':$q->whereNull('warranty_expires_on');
                break;
            case 'expired':$q->whereDate('warranty_expires_on', '<', today());
                break;
            case 'expiring':$q->whereBetween('warranty_expires_on', [today()->toDateString(), today()->addDays(30)->toDateString()]);
                break;
            case 'covered':$q->whereDate('warranty_expires_on', '>', today()->addDays(30));
                break;
        }

        return $q->orderBy($d['sort'] ?? 'tag', $d['direction'] ?? 'asc')->orderBy('id')->paginate(15);
    }

    public function stats()
    {
        return response()->json(['total' => Asset::count(), 'available' => Asset::where('status', 'available')->count(), 'in_use' => Asset::where('status', 'in_use')->count(), 'repair' => Asset::where('status', 'repair')->count(), 'warranty_expiring' => Asset::whereNotIn('status', ['retired', 'disposed'])->whereBetween('warranty_expires_on', [today()->toDateString(), today()->addDays(30)->toDateString()])->count()]);
    }

    public function options(Request $r)
    {
        $d = $r->validate(['search' => 'nullable|string|max:100']);
        $search = '%'.strtolower($d['search'] ?? '').'%';

        return response()->json(['categories' => Asset::CATEGORIES, 'statuses' => Asset::STATUSES, 'departments' => Department::orderBy('name')->get(['id', 'name']), 'users' => User::where('is_active', true)->whereRaw('LOWER(name) LIKE ?', [$search])->orderBy('name')->orderBy('id')->limit(30)->get(['id', 'name']), 'devices' => $r->user()->hasPermission('devices.view') ? Device::whereNull('revoked_at')->whereRaw('LOWER(name) LIKE ?', [$search])->orderBy('name')->orderBy('id')->limit(30)->get(['id', 'name']) : []]);
    }

    public function show(string $asset)
    {
        return response()->json(['data' => Asset::with(Asset::RELATIONS)->findOrFail($asset)]);
    }

    public function history(Request $r, string $asset)
    {
        $r->validate(['page' => 'integer|min:1']);

        return Asset::findOrFail($asset)->events()->with('actor:id,name')->orderByDesc('id')->paginate(15);
    }

    public function assignments(Request $r, string $asset)
    {
        $r->validate(['page' => 'integer|min:1']);

        return Asset::findOrFail($asset)->assignments()->with(['user:id,name', 'assigner:id,name', 'returner:id,name'])->orderByDesc('assigned_at')->orderByDesc('id')->paginate(15);
    }

    public function save(Request $r, AssetService $service, ?string $asset = null)
    {
        if (is_string($r->input('tag'))) {
            $r->merge(['tag' => strtoupper(trim($r->input('tag')))]);
        }
        $d = $r->validate(['tag' => 'required|string|max:40|regex:/^[A-Z0-9][A-Z0-9._-]*$/', 'name' => 'required|string|max:160', 'category' => ['required', Rule::in(Asset::CATEGORIES)], 'manufacturer' => 'present|nullable|string|max:120', 'model' => 'present|nullable|string|max:160', 'serial_number' => 'present|nullable|string|max:160', 'purchased_on' => 'present|nullable|date_format:Y-m-d', 'warranty_expires_on' => 'present|nullable|date_format:Y-m-d', 'department_id' => 'present|nullable|uuid|exists:departments,id', 'device_id' => 'present|nullable|uuid|exists:devices,id', 'location' => 'present|nullable|string|max:160', 'status' => ['required', Rule::in(Asset::STATUSES)], 'notes' => 'present|nullable|string|max:5000', 'version' => $asset ? 'required|integer|min:1' : 'prohibited']);
        if (($d['purchased_on'] ?? null) && ($d['warranty_expires_on'] ?? null)) {
            abort_if($d['warranty_expires_on'] < $d['purchased_on'], 422, 'Warranty expiration cannot precede the purchase date.');
        }

        return response()->json(['data' => $service->save($r->user(), $d, $asset)->load(Asset::RELATIONS)], $asset ? 200 : 201);
    }

    public function assign(Request $r, string $asset, AssetService $service)
    {
        $d = $r->validate(['version' => 'required|integer|min:1', 'user_id' => 'required|uuid|exists:users,id', 'notes' => 'required|string|min:3|max:900']);

        return response()->json(['data' => $service->assign($r->user(), $asset, $d)->load(Asset::RELATIONS)]);
    }

    public function returnAsset(Request $r, string $asset, AssetService $service)
    {
        $d = $r->validate(['version' => 'required|integer|min:1', 'status' => ['required', Rule::in(array_diff(Asset::STATUSES, ['in_use']))], 'notes' => 'required|string|min:3|max:900']);

        return response()->json(['data' => $service->returnAsset($r->user(), $asset, $d)->load(Asset::RELATIONS)]);
    }
}

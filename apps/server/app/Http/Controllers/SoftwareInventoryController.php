<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\InstalledSoftware;
use App\Services\SoftwareInventoryService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SoftwareInventoryController extends Controller
{
    public function ingest(Request $r, SoftwareInventoryService $service)
    {
        abort_if(array_diff(array_keys($r->all()), ['complete', 'applications']), 422);
        $d = $r->validate(['complete' => 'required|boolean', 'applications' => 'present|array|max:500', 'applications.*' => 'array:source_key,name,version,publisher,installed_on', 'applications.*.source_key' => 'required|string|regex:/^[a-f0-9]{64}$/|distinct', 'applications.*.name' => 'required|string|max:200', 'applications.*.version' => 'present|nullable|string|max:100', 'applications.*.publisher' => 'present|nullable|string|max:160', 'applications.*.installed_on' => 'present|nullable|date_format:Y-m-d']);
        $service->ingest($r->attributes->get('device'), $d);

        return response()->json(['received_at' => now()->toIso8601String()]);
    }

    public function index(Request $r)
    {
        $d = $r->validate(['search' => 'nullable|string|max:100', 'publisher' => 'nullable|string|max:100', 'device_id' => 'nullable|uuid', 'status' => ['nullable', Rule::in(['present', 'removed', 'all'])], 'sort' => ['nullable', Rule::in(['name', 'version', 'publisher', 'last_detected_at'])], 'direction' => ['nullable', Rule::in(['asc', 'desc'])], 'page' => 'integer|min:1']);
        $q = InstalledSoftware::with('device:id,name,revoked_at,software_inventory_at,software_inventory_complete');
        foreach (['name' => 'search', 'publisher' => 'publisher'] as $column => $parameter) {
            if ($s = $d[$parameter] ?? null) {
                $q->whereRaw('LOWER('.$column.') LIKE ?', ['%'.strtolower($s).'%']);
            }
        }
        if ($d['device_id'] ?? null) {
            $q->where('device_id', $d['device_id']);
        }
        if (($d['status'] ?? 'present') === 'present') {
            $q->whereNull('removed_at');
        } elseif ($d['status'] === 'removed') {
            $q->whereNotNull('removed_at');
        }

        return $q->orderBy($d['sort'] ?? 'name', $d['direction'] ?? 'asc')->orderBy('id')->paginate(20);
    }

    public function coverage()
    {
        $q = Device::whereNull('revoked_at');

        return response()->json(['devices' => (clone $q)->count(), 'reported' => (clone $q)->whereNotNull('software_inventory_at')->count(), 'fresh_complete' => (clone $q)->where('software_inventory_at', '>=', now()->subHours(8))->where('software_inventory_complete', true)->count(), 'partial' => (clone $q)->where('software_inventory_complete', false)->count(), 'scope' => 'Machine-wide uninstall registry entries. Per-user, Store and portable apps are not included.']);
    }
}

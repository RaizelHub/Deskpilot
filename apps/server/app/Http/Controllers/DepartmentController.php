<?php

namespace App\Http\Controllers;

use App\Models\Department;
use App\Services\DepartmentService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DepartmentController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate(['search' => 'nullable|string|max:100', 'page' => 'integer|min:1', 'per_page' => 'integer|min:1|max:100']);

        return Department::withCount('users')->when($data['search'] ?? null, fn ($q, $search) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.strtolower($search).'%']))->orderBy('name')->paginate($data['per_page'] ?? 15);
    }

    public function store(Request $request, DepartmentService $service)
    {
        return response()->json(['data' => $service->save($request->user(), $this->validated($request))], 201);
    }

    public function update(Request $request, Department $department, DepartmentService $service)
    {
        return response()->json(['data' => $service->save($request->user(), $this->validated($request, $department), $department)]);
    }

    public function destroy(Request $request, Department $department, DepartmentService $service)
    {
        $service->delete($request->user(), $department);

        return response()->noContent();
    }

    private function validated(Request $request, ?Department $department = null): array
    {
        return $request->validate(['name' => ['required', 'string', 'max:100', Rule::unique('departments')->ignore($department)], 'description' => 'nullable|string|max:2000']);
    }
}

<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveUserRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate(['search' => 'nullable|string|max:100', 'page' => 'integer|min:1', 'per_page' => 'integer|min:1|max:100', 'sort' => [Rule::in(['name', 'email', 'created_at'])], 'direction' => [Rule::in(['asc', 'desc'])], 'active' => [Rule::in(['all', 'active', 'inactive'])]]);
        $query = User::with('roles', 'department');
        if ($search = $data['search'] ?? null) {
            $query->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.strtolower($search).'%'])->orWhereRaw('LOWER(email) LIKE ?', ['%'.strtolower($search).'%']));
        }
        if (($data['active'] ?? 'all') !== 'all') {
            $query->where('is_active', $data['active'] === 'active');
        }

        return UserResource::collection($query->orderBy($data['sort'] ?? 'name', $data['direction'] ?? 'asc')->orderBy('id')->paginate($data['per_page'] ?? 15));
    }

    public function store(SaveUserRequest $request, UserService $service)
    {
        return (new UserResource($service->save($request->user(), $request->validated())))->response()->setStatusCode(201);
    }

    public function update(SaveUserRequest $request, User $user, UserService $service)
    {
        return new UserResource($service->save($request->user(), $request->validated(), $user));
    }

    public function bulkStatus(Request $request, UserService $service)
    {
        $data = $request->validate(['ids' => 'required|array|min:1|max:100', 'ids.*' => 'required|uuid|distinct|exists:users,id', 'is_active' => 'required|boolean']);
        DB::transaction(function () use ($request, $service, $data) {
            foreach (User::whereIn('id', $data['ids'])->orderBy('id')->get() as $user) {
                $service->save($request->user(), $user->only(['name', 'email', 'department_id']) + ['is_active' => $data['is_active'], 'role_ids' => $user->roles()->pluck('roles.id')->all()], $user);
            }
        });

        return response()->json(['message' => 'Selected accounts updated.']);
    }
}

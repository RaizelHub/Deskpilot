<?php

namespace App\Services;

use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class UserService
{
    public function __construct(private Audit $audit) {}

    public function save(User $actor, array $data, ?User $user = null): User
    {
        return DB::transaction(function () use ($actor, $data, $user) {
            // Stable lock serializes privilege and activation changes, including last-admin checks.
            Role::orderBy('id')->lockForUpdate()->get();
            $actor = $actor->fresh();
            abort_unless($actor->hasPermission('users.manage'), 403);
            $user = $user?->fresh();
            $roles = Role::with('permissions')->whereIn('id', $data['role_ids'])->get();
            $changingRoles = ! $user || $user->roles()->pluck('roles.id')->sort()->values()->all() !== collect($data['role_ids'])->sort()->values()->all();
            if ($changingRoles) {
                $grants = $roles->flatMap->permissions->pluck('name')->unique()->all();
                abort_if(count(array_diff($grants, $actor->permissionNames())) > 0, 403, 'You cannot grant permissions you do not hold.');
                abort_if(! $actor->hasPermission('roles.manage') && $roles->where('slug', 'employee')->count() !== $roles->count(), 403, 'Role administration permission is required.');
            }
            if ($user && in_array('roles.manage', $user->permissionNames(), true) && ! $actor->hasPermission('roles.manage')) {
                abort(403, 'You cannot change a privileged administrator.');
            }
            $before = $user ? $user->only(['name', 'email', 'department_id', 'is_active']) + ['role_ids' => $user->roles()->pluck('roles.id')->all()] : null;
            $emailChanged = $user && $user->email !== $data['email'];
            $new = ! $user;
            $revokingAccess = $user && $user->is_active && ! $data['is_active'];
            $user ??= new User;
            $user->fill(collect($data)->except('role_ids')->all());
            if ($revokingAccess) {
                $user->auth_version++;
            }
            if ($emailChanged) {
                $user->email_verified_at = null;
            }
            $user->save();
            $user->roles()->sync($data['role_ids']);
            $administrators = User::where('is_active', true)->whereNotNull('email_verified_at')
                ->whereHas('roles.permissions', fn ($q) => $q->where('name', 'roles.manage'))
                ->whereHas('roles.permissions', fn ($q) => $q->where('name', 'users.manage'))->exists();
            if (! $administrators) {
                throw ValidationException::withMessages(['role_ids' => 'Keep at least one active, verified administrator with user and role management access.']);
            }
            $this->audit->record($new ? 'user.created' : 'user.updated', $actor, $user, ['before' => $before, 'after' => $user->only(['name', 'email', 'department_id', 'is_active']) + ['role_ids' => $data['role_ids']]]);
            if ($new || $emailChanged) {
                $user->sendEmailVerificationNotification();
            }

            return $user->load('roles', 'department');
        });
    }
}

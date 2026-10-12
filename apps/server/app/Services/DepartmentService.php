<?php

namespace App\Services;

use App\Models\Department;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class DepartmentService
{
    public function __construct(private Audit $audit) {}

    public function save(User $actor, array $data, ?Department $department = null): Department
    {
        return DB::transaction(function () use ($actor, $data, $department) {
            $new = ! $department;
            $department ??= new Department;
            $department->fill($data)->save();
            $this->audit->record($new ? 'department.created' : 'department.updated', $actor, $department, $department->only(['name', 'description']));

            return $department->loadCount('users');
        });
    }

    public function delete(User $actor, Department $department): void
    {
        DB::transaction(function () use ($actor, $department) {
            $department = Department::whereKey($department->id)->lockForUpdate()->firstOrFail();
            if ($department->users()->exists()) {
                throw ValidationException::withMessages(['department' => 'Move the assigned users before deleting this department.']);
            }
            foreach (['devices', 'enrollment_grants', 'tickets', 'assets'] as $table) {
                if (DB::table($table)->where('department_id', $department->id)->exists()) {
                    throw ValidationException::withMessages(['department' => 'This department is referenced by device, enrollment, ticket, or asset records and must be retained.']);
                }
            }
            $this->audit->record('department.deleted', $actor, $department, ['name' => $department->name]);
            $department->delete();
        });
    }
}

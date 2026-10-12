<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;

class DemoSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local', 'testing')) {
            throw new \RuntimeException('Demo seeding is development-only.');
        }
        $password = getenv('DESKPILOT_DEMO_PASSWORD');
        if (! is_string($password) || strlen($password) < 12) {
            throw new \RuntimeException('Provide DESKPILOT_DEMO_PASSWORD with at least 12 characters.');
        }
        $this->call(RolePermissionSeeder::class);
        foreach (['IT', 'Accounting', 'Human Resources', 'Operations', 'Sales'] as $name) {
            Department::firstOrCreate(['name' => $name]);
        }
        foreach (['admin' => 'super-administrator', 'technician' => 'it-technician', 'employee' => 'employee'] as $name => $role) {
            $user = User::firstOrCreate(['email' => $name.'@example.test'], ['name' => ucfirst($name), 'password' => $password, 'is_active' => true, 'department_id' => Department::where('name', 'IT')->value('id')]);
            $user->forceFill(['email_verified_at' => now()])->save();
            $user->roles()->sync([Role::where('slug', $role)->value('id')]);
        }
    }
}

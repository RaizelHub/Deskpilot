<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RolePermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permissions = ['knowledge.view', 'knowledge.staff', 'knowledge.manage', 'ai.use', 'automation.view', 'automation.manage', 'monitoring.view', 'monitoring.acknowledge', 'monitoring.manage', 'dashboard.view', 'users.view', 'users.manage', 'departments.view', 'departments.manage', 'roles.view', 'roles.manage', 'audit.view', 'tickets.view', 'tickets.create', 'tickets.assign', 'tickets.update', 'tickets.resolve', 'devices.view', 'devices.manage', 'devices.diagnostics', 'remote.request', 'remote.control', 'remote.unattended', 'assets.view', 'assets.manage', 'reports.view', 'settings.manage'];
        $roles = [
            'super-administrator' => ['Super Administrator', $permissions],
            'it-administrator' => ['IT Administrator', array_diff($permissions, ['roles.manage', 'remote.unattended'])],
            'it-technician' => ['IT Technician', ['monitoring.view', 'monitoring.acknowledge', 'dashboard.view', 'departments.view', 'tickets.view', 'tickets.create', 'tickets.assign', 'tickets.update', 'tickets.resolve', 'devices.view', 'devices.diagnostics', 'remote.request', 'remote.control', 'assets.view', 'reports.view']],
            'helpdesk-agent' => ['Helpdesk Agent', ['dashboard.view', 'departments.view', 'tickets.view', 'tickets.create', 'tickets.assign', 'tickets.update']],
            'department-manager' => ['Department Manager', ['dashboard.view', 'tickets.view', 'tickets.create']],
            'employee' => ['Employee', ['dashboard.view', 'tickets.view', 'tickets.create']],
        ];
        $helpdesk = ['tickets.view_all', 'tickets.view_department', 'tickets.create_for_others', 'tickets.reply', 'tickets.notes'];
        $permissions = array_merge($permissions, $helpdesk);
        foreach (['super-administrator', 'it-administrator', 'it-technician', 'helpdesk-agent'] as $slug) {
            $roles[$slug][1] = array_merge($roles[$slug][1], array_diff($helpdesk, ['tickets.view_department']));
        }
        $roles['department-manager'][1][] = 'tickets.view_department';
        foreach ($roles as $slug => &$role) {
            $role[1][] = 'knowledge.view';
            if (in_array($slug, ['it-technician', 'helpdesk-agent'])) {
                $role[1][] = 'knowledge.staff';
                $role[1][] = 'ai.use';
            }
        } unset($role);
        DB::transaction(function () use ($permissions, $roles) {
            foreach ($permissions as $name) {
                Permission::firstOrCreate(['name' => $name]);
            }
            foreach ($roles as $slug => [$name, $grants]) {
                $role = Role::firstOrCreate(['slug' => $slug], ['name' => $name]);
                $role->permissions()->sync(Permission::whereIn('name', $grants)->pluck('id'));
            }
        });
    }
}

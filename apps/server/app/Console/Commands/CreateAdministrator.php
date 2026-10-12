<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use App\Services\Audit;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class CreateAdministrator extends Command
{
    protected $signature = 'deskpilot:create-admin';

    protected $description = 'Create a verified administrator using an interactive password prompt';

    public function handle(Audit $audit): int
    {
        $data = ['name' => $this->ask('Full name'), 'email' => strtolower((string) $this->ask('Email')), 'password' => $this->secret('Password (12+ characters, letters and numbers)')];
        $validation = Validator::make($data, ['name' => 'required|string|max:100', 'email' => 'required|email|max:254|unique:users,email', 'password' => ['required', Password::min(12)->letters()->numbers(), 'max:128']]);
        if ($validation->fails()) {
            foreach ($validation->errors()->all() as $error) {
                $this->error($error);
            }

return self::FAILURE;
        }
        if ($data['password'] !== $this->secret('Confirm password')) {
            $this->error('Passwords do not match.');

            return self::FAILURE;
        }
        DB::transaction(function () use ($data, $audit) {
            (new RolePermissionSeeder)->run();
            $user = User::create($data + ['is_active' => true]);
            $user->forceFill(['email_verified_at' => now()])->save();
            $user->roles()->attach(Role::where('slug', 'super-administrator')->firstOrFail());
            $audit->record('user.bootstrap_administrator', $user, $user);
        });
        $this->info('Administrator created. You can now sign in.');

        return self::SUCCESS;
    }
}

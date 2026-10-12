<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use App\Notifications\ResetPasswordNotification;
use App\Notifications\VerifyEmailNotification;
use App\Services\UserService;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class FoundationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->seed(RolePermissionSeeder::class);
        $this->admin = $this->account('admin@example.test', 'super-administrator');
        $this->employee = $this->account('employee@example.test', 'employee');
    }

    private function account(string $email, string $role): User
    {
        $user = User::factory()->create(['email' => $email, 'password' => 'TestingPassword123!', 'is_active' => true]);
        $user->roles()->attach(Role::where('slug', $role)->firstOrFail());

        return $user;
    }

    private function payload(User $user, array $extra = []): array
    {
        return array_merge($user->only(['name', 'email', 'department_id', 'is_active']), ['role_ids' => $user->roles()->pluck('roles.id')->all()], $extra);
    }

    public function test_guest_cannot_read_workspace(): void
    {
        $this->getJson('/api/v1/users')->assertUnauthorized();
        $this->getJson('/api/v1/dashboard')->assertUnauthorized();
    }

    public function test_login_me_and_logout(): void
    {
        $this->postJson('/api/v1/auth/login', ['email' => 'ADMIN@example.test', 'password' => 'TestingPassword123!'])->assertOk()->assertJsonPath('user.id', $this->admin->id)->assertJsonMissingPath('user.password');
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.email', 'admin@example.test');
        $this->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login']);
    }

    public function test_invalid_login_is_rate_limited(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', ['email' => 'unknown@example.test', 'password' => 'incorrect'])->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/login', ['email' => 'unknown@example.test', 'password' => 'incorrect'])->assertStatus(429);
    }

    public function test_employee_cannot_manage_or_list_other_users(): void
    {
        $this->actingAs($this->employee)->getJson('/api/v1/users')->assertForbidden();
        $this->postJson('/api/v1/users', [])->assertForbidden();
        $this->getJson('/api/v1/audit-logs')->assertForbidden();
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('users', null)->assertJsonPath('recent_activity', []);
    }

    public function test_unverified_account_can_only_use_account_endpoints(): void
    {
        $this->admin->forceFill(['email_verified_at' => null])->save();
        $this->actingAs($this->admin)->getJson('/api/v1/users')->assertForbidden();
        $this->getJson('/api/v1/auth/me')->assertOk();
        $this->postJson('/api/v1/auth/verification-notification')->assertOk();
        Notification::assertSentTo($this->admin, VerifyEmailNotification::class);
    }

    public function test_disabled_account_cannot_login_or_use_old_session(): void
    {
        $this->employee->update(['is_active' => false]);
        $this->postJson('/api/v1/auth/login', ['email' => $this->employee->email, 'password' => 'TestingPassword123!'])->assertUnprocessable();
        $this->actingAs($this->employee)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_create_user_hashes_password_and_audits_without_secrets(): void
    {
        $this->actingAs($this->admin)->postJson('/api/v1/users', ['name' => 'Maria Santos', 'email' => 'MARIA@example.test', 'password' => 'PrivateInitial123!', 'is_active' => true, 'role_ids' => [Role::where('slug', 'employee')->value('id')]])->assertCreated()->assertJsonPath('data.email', 'maria@example.test')->assertJsonMissingPath('data.password');
        $user = User::where('email', 'maria@example.test')->firstOrFail();
        $this->assertTrue(Hash::check('PrivateInitial123!', $user->password));
        $this->assertNull($user->email_verified_at);
        Notification::assertSentTo($user, VerifyEmailNotification::class);
        $this->assertStringNotContainsString('PrivateInitial123!', AuditLog::all()->toJson());
    }

    public function test_user_validation_rejects_duplicate_email_and_invalid_role(): void
    {
        $this->actingAs($this->admin)->postJson('/api/v1/users', ['name' => 'Duplicate', 'email' => $this->admin->email, 'password' => 'short', 'is_active' => true, 'role_ids' => ['invalid']])->assertUnprocessable()->assertJsonValidationErrors(['email', 'password', 'role_ids.0']);
    }

    public function test_privilege_escalation_is_rejected(): void
    {
        $itAdmin = $this->account('it@example.test', 'it-administrator');
        $this->actingAs($itAdmin)->patchJson('/api/v1/users/'.$this->employee->id, $this->payload($this->employee, ['role_ids' => [Role::where('slug', 'super-administrator')->value('id')]]))->assertForbidden();
    }

    public function test_inactive_privileged_accounts_are_still_protected(): void
    {
        $otherAdmin = $this->account('other-admin@example.test', 'super-administrator');
        $otherAdmin->update(['is_active' => false]);
        $itAdmin = $this->account('it@example.test', 'it-administrator');
        $this->actingAs($itAdmin)->patchJson('/api/v1/users/'.$otherAdmin->id, $this->payload($otherAdmin, ['is_active' => true]))->assertForbidden();
    }

    public function test_deactivation_revokes_sessions_even_after_reactivation(): void
    {
        $version = $this->employee->auth_version;
        $service = app(UserService::class);
        $service->save($this->admin, $this->payload($this->employee, ['is_active' => false]), $this->employee);
        $service->save($this->admin, $this->payload($this->employee->fresh(), ['is_active' => true]), $this->employee->fresh());
        $this->actingAs($this->employee->fresh())->withSession(['auth_version' => $version])->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_last_administrator_cannot_be_disabled_demoted_or_unverified(): void
    {
        $this->actingAs($this->admin)->patchJson('/api/v1/users/'.$this->admin->id, $this->payload($this->admin, ['is_active' => false]))->assertUnprocessable();
        $this->patchJson('/api/v1/users/'.$this->admin->id, $this->payload($this->admin, ['role_ids' => [Role::where('slug', 'employee')->value('id')]]))->assertUnprocessable();
        $this->patchJson('/api/v1/users/'.$this->admin->id, $this->payload($this->admin, ['email' => 'new@example.test']))->assertUnprocessable();
        $this->assertTrue($this->admin->fresh()->is_active);
    }

    public function test_users_filter_sort_and_pagination(): void
    {
        $this->actingAs($this->admin)->getJson('/api/v1/users?search=employee&per_page=1&sort=email')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/users?sort=password')->assertUnprocessable();
    }

    public function test_department_lifecycle_and_assigned_delete_guard(): void
    {
        $result = $this->actingAs($this->admin)->postJson('/api/v1/departments', ['name' => 'Accounting', 'description' => 'Finance team'])->assertCreated();
        $id = $result->json('data.id');
        $this->patchJson('/api/v1/departments/'.$id, ['name' => 'Finance', 'description' => 'Updated'])->assertOk();
        $this->employee->update(['department_id' => $id]);
        $this->deleteJson('/api/v1/departments/'.$id)->assertUnprocessable();
        $this->employee->update(['department_id' => null]);
        $this->deleteJson('/api/v1/departments/'.$id)->assertNoContent();
        $this->assertDatabaseHas('audit_logs', ['action' => 'department.deleted', 'target_id' => $id]);
    }

    public function test_bulk_update_is_atomic_when_last_admin_is_selected(): void
    {
        $this->actingAs($this->admin)->postJson('/api/v1/users/bulk-status', ['ids' => [$this->employee->id, $this->admin->id], 'is_active' => false])->assertUnprocessable();
        $this->assertTrue($this->employee->fresh()->is_active);
        $this->postJson('/api/v1/users/bulk-status', ['ids' => [$this->employee->id], 'is_active' => false])->assertOk();
        $this->assertFalse($this->employee->fresh()->is_active);
    }

    public function test_password_reset_is_generic_and_token_is_single_use(): void
    {
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $this->employee->email])->assertOk();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'absent@example.test'])->assertOk();
        $token = null;
        Notification::assertSentTo($this->employee, ResetPasswordNotification::class, function ($notification) use (&$token) {
            $token = $notification->token;

            return true;
        });
        $payload = ['email' => $this->employee->email, 'token' => $token, 'password' => 'NewSecretPassword123!', 'password_confirmation' => 'NewSecretPassword123!'];
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertOk();
        $this->postJson('/api/v1/auth/reset-password', $payload)->assertUnprocessable();
        $this->assertTrue(Hash::check($payload['password'], $this->employee->fresh()->password));
    }

    public function test_verification_is_signed_and_bound_to_authenticated_user(): void
    {
        $this->employee->forceFill(['email_verified_at' => null])->save();
        $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(30), ['id' => $this->employee->id, 'hash' => sha1($this->employee->email)]);
        $this->actingAs($this->admin)->getJson($url)->assertForbidden();
        $this->flushSession();
        $this->actingAs($this->employee)->getJson($url.'&extra=tamper')->assertForbidden();
        $this->getJson($url)->assertOk();
        $this->assertNotNull($this->employee->fresh()->email_verified_at);
    }

    public function test_password_change_requires_current_password(): void
    {
        $payload = ['current_password' => 'wrong', 'password' => 'ChangedPassword123!', 'password_confirmation' => 'ChangedPassword123!'];
        $this->actingAs($this->employee)->postJson('/api/v1/auth/password', $payload)->assertUnprocessable();
        $payload['current_password'] = 'TestingPassword123!';
        $this->postJson('/api/v1/auth/password', $payload)->assertOk();
    }

    public function test_mutations_reject_missing_csrf_outside_test_bypass(): void
    {
        $this->app->instance('env', 'local');
        $this->postJson('/api/v1/auth/login', ['email' => $this->admin->email, 'password' => 'TestingPassword123!'])->assertStatus(419);
    }
}

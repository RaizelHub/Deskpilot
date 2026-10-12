<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\Audit;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Foundation\Auth\EmailVerificationRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request, Audit $audit)
    {
        $request->merge(['email' => strtolower(trim((string) $request->input('email')))]);
        $data = $request->validate(['email' => 'required|email|max:254', 'password' => 'required|string|max:128']);
        if (! Auth::attempt($data + ['is_active' => true])) {
            $audit->record('auth.login_failed');
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect, or the account is inactive.']);
        }
        $request->session()->regenerate();
        $request->session()->put('auth_version', $request->user()->auth_version);
        $audit->record('auth.login', $request->user());

        return $this->me($request);
    }

    public function me(Request $request)
    {
        return response()->json(['user' => new UserResource($request->user()->load('roles', 'department')), 'permissions' => $request->user()->permissionNames()]);
    }

    public function logout(Request $request, Audit $audit)
    {
        $audit->record('auth.logout', $request->user());
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    public function forgot(Request $request)
    {
        $data = $request->validate(['email' => 'required|email|max:254']);
        Password::sendResetLink(['email' => strtolower($data['email']), 'is_active' => true]);

        return response()->json(['message' => 'If that active account exists, a password reset email will be sent.']);
    }

    public function reset(Request $request, Audit $audit)
    {
        $data = $request->validate(['email' => 'required|email|max:254', 'token' => 'required|string|max:256', 'password' => ['required', 'confirmed', PasswordRule::min(12)->letters()->numbers(), 'max:128']]);
        $data['email'] = strtolower($data['email']);
        $status = Password::reset($data + ['is_active' => true], function (User $user, string $password) use ($audit) {
            $user->forceFill(['password' => Hash::make($password), 'remember_token' => Str::random(60)])->save();
            $audit->record('auth.password_reset', $user, $user);
            event(new PasswordReset($user));
        });
        if ($status !== Password::PasswordReset) {
            throw ValidationException::withMessages(['email' => __($status)]);
        }

        return response()->json(['message' => 'Password updated. Sign in with your new password.']);
    }

    public function verify(EmailVerificationRequest $request, Audit $audit)
    {
        $request->fulfill();
        $audit->record('auth.email_verified', $request->user(), $request->user());

        return response()->json(['message' => 'Email verified. Your workspace is ready.']);
    }

    public function resend(Request $request)
    {
        if (! $request->user()->hasVerifiedEmail()) {
            $request->user()->sendEmailVerificationNotification();
        }

        return response()->json(['message' => 'Verification email queued. Check your inbox.']);
    }

    public function password(Request $request, Audit $audit)
    {
        $data = $request->validate(['current_password' => 'required|current_password', 'password' => ['required', 'confirmed', PasswordRule::min(12)->letters()->numbers(), 'max:128']]);
        $request->user()->forceFill(['password' => $data['password'], 'remember_token' => Str::random(60)])->save();
        $request->session()->put('password_hash_web', $request->user()->getAuthPassword());
        $request->session()->regenerate();
        $audit->record('auth.password_changed', $request->user(), $request->user());

        return response()->json(['message' => 'Password updated. Other sessions must sign in again.']);
    }
}

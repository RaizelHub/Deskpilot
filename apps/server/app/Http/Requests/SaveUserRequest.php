<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class SaveUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('users.manage');
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('email')) {
            $this->merge(['email' => strtolower(trim((string) $this->input('email')))]);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:254', Rule::unique('users')->ignore($this->route('user'))],
            'password' => [$this->isMethod('post') ? 'required' : 'prohibited', Password::min(12)->letters()->numbers(), 'max:128'],
            'department_id' => ['nullable', 'uuid', 'exists:departments,id'],
            'is_active' => ['required', 'boolean'],
            'role_ids' => ['required', 'array', 'min:1', 'max:6'],
            'role_ids.*' => ['required', 'uuid', 'distinct', 'exists:roles,id'],
        ];
    }
}

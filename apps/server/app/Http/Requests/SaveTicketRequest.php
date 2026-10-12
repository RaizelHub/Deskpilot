<?php

namespace App\Http\Requests;

use App\Models\Ticket;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission('tickets.view');
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'min:3', 'max:160'], 'description' => [$required, 'string', 'min:5', 'max:15000'],
            'category_id' => [$required, 'uuid', 'exists:ticket_categories,id'], 'priority' => [$required, Rule::in(Ticket::PRIORITIES)],
            'requester_id' => [$this->isMethod('post') ? 'sometimes' : 'prohibited', 'uuid', 'exists:users,id'],
            'assignee_id' => ['sometimes', 'nullable', 'uuid', 'exists:users,id'], 'reported_device' => ['sometimes', 'nullable', 'string', 'max:100'],
            'tags' => ['sometimes', 'array', 'max:10'], 'tags.*' => ['string', 'regex:/^[a-z0-9][a-z0-9-]{0,29}$/', 'distinct'],
            'status' => [$this->isMethod('post') ? 'prohibited' : 'sometimes', Rule::in(Ticket::STATUSES)],
            'resolution_notes' => [$this->isMethod('post') ? 'prohibited' : 'sometimes', 'nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('post') ? 'prohibited' : 'required', 'integer', 'min:1'],
        ];
    }
}

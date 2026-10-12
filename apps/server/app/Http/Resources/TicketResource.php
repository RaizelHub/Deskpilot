<?php

namespace App\Http\Resources;

use App\Services\TicketAccess;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TicketResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'number' => $this->number, 'title' => $this->title, 'description' => $this->description,
            'requester_id' => $this->requester_id, 'assignee_id' => $this->assignee_id, 'department_id' => $this->department_id, 'category_id' => $this->category_id,
            'requester' => $this->whenLoaded('requester'), 'assignee' => $this->whenLoaded('assignee'), 'department' => $this->whenLoaded('department'), 'category' => $this->whenLoaded('category'), 'tags' => $this->whenLoaded('tags'),
            'reported_device' => $this->reported_device, 'status' => $this->status, 'priority' => $this->priority, 'version' => $this->version, 'resolution_notes' => $this->resolution_notes,
            'created_at' => $this->created_at, 'updated_at' => $this->updated_at, 'first_response_due_at' => $this->first_response_due_at, 'resolution_due_at' => $this->resolution_due_at,
            'first_response_at' => $this->first_response_at, 'resolved_at' => $this->resolved_at, 'closed_at' => $this->closed_at,
            'sla' => $this->slaState(), 'permissions' => app(TicketAccess::class)->permissions($request->user(), $this->resource),
        ];
    }
}

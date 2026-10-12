<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveTicketRequest;
use App\Http\Resources\TicketResource;
use App\Models\Ticket;
use App\Models\TicketCategory;
use App\Models\User;
use App\Services\Audit;
use App\Services\TicketAccess;
use App\Services\TicketAttachmentService;
use App\Services\TicketService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class TicketController extends Controller
{
    public function __construct(private TicketAccess $access, private TicketService $tickets) {}

    public function index(Request $request)
    {
        $data = $request->validate([
            'search' => 'nullable|string|max:100', 'page' => 'integer|min:1', 'per_page' => 'integer|min:1|max:100',
            'status' => ['nullable', Rule::in(Ticket::STATUSES)], 'priority' => ['nullable', Rule::in(Ticket::PRIORITIES)],
            'category_id' => 'nullable|uuid', 'assignee_id' => 'nullable|uuid', 'tag' => 'nullable|string|max:30',
            'queue' => ['nullable', Rule::in(['all', 'mine', 'assigned', 'unassigned', 'overdue'])],
            'sort' => ['nullable', Rule::in(['created_at', 'updated_at', 'title', 'number', 'priority', 'resolution_due_at'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $query = $this->access->query($request->user())->with(Ticket::RELATIONS);
        if ($search = $data['search'] ?? null) {
            $term = '%'.strtolower($search).'%';
            $query->where(fn ($q) => $q->whereRaw('LOWER(title) LIKE ?', [$term])->orWhereRaw('LOWER(number) LIKE ?', [$term])->orWhereRaw('LOWER(description) LIKE ?', [$term]));
        }
        foreach (['status', 'priority', 'category_id', 'assignee_id'] as $field) {
            if (! empty($data[$field])) {
                $query->where($field, $data[$field]);
            }
        }
        if (! empty($data['tag'])) {
            $query->whereHas('tags', fn ($q) => $q->where('name', strtolower($data['tag'])));
        }
        switch ($data['queue'] ?? 'all') {
            case 'mine': $query->where('requester_id', $request->user()->id);
                break;
            case 'assigned': $query->where('assignee_id', $request->user()->id)->whereNotIn('status', ['resolved', 'closed']);
                break;
            case 'unassigned': $query->whereNull('assignee_id')->whereNotIn('status', ['resolved', 'closed']);
                break;
            case 'overdue': $query->whereNotIn('status', ['resolved', 'closed'])->where(fn ($q) => $q->where('resolution_due_at', '<', now())->orWhere(fn ($q) => $q->whereNull('first_response_at')->where('first_response_due_at', '<', now())));
                break;
        }
        $sort = $data['sort'] ?? 'created_at';
        $direction = $data['direction'] ?? 'desc';
        if ($sort === 'priority') {
            $query->orderByRaw("CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END ".$direction);
        } else {
            $query->orderBy($sort, $direction);
        }

        return TicketResource::collection($query->orderBy('id')->paginate($data['per_page'] ?? 15));
    }

    public function store(SaveTicketRequest $request)
    {
        return (new TicketResource($this->tickets->create($request->user(), $request->validated())))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $ticket)
    {
        return new TicketResource($this->access->find($request->user(), $ticket)->load(Ticket::RELATIONS));
    }

    public function update(SaveTicketRequest $request, string $ticket)
    {
        return new TicketResource($this->tickets->update($request->user(), $ticket, $request->validated()));
    }

    public function reopen(Request $request, string $ticket)
    {
        $data = $request->validate(['version' => 'required|integer|min:1', 'reason' => 'required|string|min:3|max:2000']);

        return new TicketResource($this->tickets->reopen($request->user(), $ticket, $data['version'], $data['reason']));
    }

    public function bulk(Request $request)
    {
        $data = $request->validate([
            'items' => 'required|array|min:1|max:50', 'items.*.id' => 'required|uuid|distinct', 'items.*.version' => 'required|integer|min:1',
            'changes' => 'required|array|min:1', 'changes.status' => ['sometimes', Rule::in(Ticket::STATUSES)],
            'changes.priority' => ['sometimes', Rule::in(Ticket::PRIORITIES)], 'changes.assignee_id' => 'sometimes|nullable|uuid|exists:users,id', 'changes.resolution_notes' => 'sometimes|nullable|string|max:5000',
        ]);
        $changes = collect($data['changes'])->only(['status', 'priority', 'assignee_id', 'resolution_notes'])->all();
        abort_if(! $changes, 422, 'Select at least one change.');
        $this->tickets->bulk($request->user(), $data['items'], $changes);

        return response()->json(['message' => 'Selected tickets updated.']);
    }

    public function comments(Request $request, string $ticket)
    {
        $request->validate(['page' => 'integer|min:1']);

        return $this->access->find($request->user(), $ticket)->comments()->with('author:id,name')
            ->when(! $request->user()->hasPermission('tickets.notes'), fn ($q) => $q->where('is_internal', false))->orderBy('created_at')->orderBy('id')->paginate(25);
    }

    public function comment(Request $request, string $ticket)
    {
        $data = $request->validate(['body' => 'required|string|min:1|max:10000', 'is_internal' => 'sometimes|boolean']);

        return response()->json(['data' => $this->tickets->comment($request->user(), $ticket, $data['body'], $data['is_internal'] ?? false)], 201);
    }

    public function history(Request $request, string $ticket)
    {
        $request->validate(['page' => 'integer|min:1']);

        return $this->access->find($request->user(), $ticket)->history()->with('actor:id,name')
            ->when(! $request->user()->hasPermission('tickets.notes'), fn ($q) => $q->where('is_internal', false))->latest()->orderByDesc('id')->paginate(25);
    }

    public function attachments(Request $request, string $ticket)
    {
        return response()->json(['data' => $this->access->find($request->user(), $ticket)->attachments()->with('uploader:id,name')
            ->when(! $request->user()->hasPermission('tickets.notes'), fn ($q) => $q->where('is_internal', false))->latest()->get()]);
    }

    public function upload(Request $request, string $ticket, TicketAttachmentService $files)
    {
        $data = $request->validate(['file' => 'required|file|max:5120', 'is_internal' => 'sometimes|boolean']);

        return response()->json(['data' => $files->upload($request->user(), $ticket, $request->file('file'), (bool) ($data['is_internal'] ?? false))], 201);
    }

    public function download(Request $request, string $ticket, string $attachment, TicketAttachmentService $files, Audit $audit)
    {
        $file = $files->find($request->user(), $ticket, $attachment);
        abort_unless(Storage::disk('tickets')->exists($file->storage_path), 404, 'This attachment is no longer available.');
        $audit->record('ticket.attachment_downloaded', $request->user(), $file);

        return Storage::disk('tickets')->download($file->storage_path, $file->filename, ['Content-Type' => 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    public function deleteAttachment(Request $request, string $ticket, string $attachment, TicketAttachmentService $files)
    {
        $files->delete($request->user(), $ticket, $attachment);

        return response()->noContent();
    }

    public function options()
    {
        return response()->json(['categories' => TicketCategory::orderBy('name')->get(), 'statuses' => Ticket::STATUSES, 'priorities' => Ticket::PRIORITIES]);
    }

    public function people(Request $request)
    {
        $data = $request->validate(['kind' => ['required', Rule::in(['requester', 'assignee'])], 'search' => 'nullable|string|max:100', 'page' => 'integer|min:1']);
        abort_unless($request->user()->hasPermission($data['kind'] === 'assignee' ? 'tickets.assign' : 'tickets.create_for_others'), 403);
        $query = $data['kind'] === 'assignee' ? $this->tickets->eligibleAssignees() : User::where('is_active', true)->whereNotNull('email_verified_at');
        if ($search = $data['search'] ?? null) {
            $query->whereRaw('LOWER(name) LIKE ?', ['%'.strtolower($search).'%']);
        }

        return $query->select('id', 'name')->orderBy('name')->paginate(50);
    }
}

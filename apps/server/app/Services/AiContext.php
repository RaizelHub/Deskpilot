<?php

namespace App\Services;

use App\Models\DeviceCommand;
use App\Models\Ticket;
use App\Models\TicketCategory;
use App\Models\User;

class AiContext
{
    public function redact(string $text, int $limit = 4000): string
    {
        $text = preg_replace('/-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/s', '[private key removed]', $text);
        $text = preg_replace('/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i', 'Bearer [redacted]', $text);
        $text = preg_replace('/\b(password|passwd|secret|api[_ -]?key|token|authorization)["\x27]?\s*[:=]\s*(?:"[^"\r\n]*"|\x27[^\x27\r\n]*\x27|[^\r\n,;]+)/i', '$1=[redacted]', $text);
        $text = preg_replace('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', '[email]', $text);
        $text = preg_replace('/\b(?:gsk_|AIza|sk-)[A-Za-z0-9_-]{15,}\b/', '[credential]', $text);

        return mb_substr($text, 0, $limit);
    }

    public function build(User $user, Ticket $ticket, ?string $diagnosticId): array
    {
        $articles = app(KnowledgeService::class)->related($user, $ticket->title.' '.$ticket->description);
        $context = ['ticket' => ['title' => $this->redact($ticket->title, 160), 'description' => $this->redact($ticket->description, 6000), 'status' => $ticket->status, 'priority' => $ticket->priority], 'recent_public_replies' => $ticket->comments()->where('is_internal', false)->latest()->orderByDesc('id')->limit(8)->get()->reverse()->map(fn ($c) => $this->redact($c->body, 1000))->values()->all(), 'diagnostic' => null, 'articles' => $articles->map(fn ($a) => ['id' => $a->id, 'title' => $this->redact($a->title, 160), 'content' => $this->redact($a->body, 3000)])->all(), 'categories' => TicketCategory::orderBy('id')->get(['id', 'name'])->toArray(), 'allowed_diagnostics' => array_keys(DiagnosticService::CATALOG)];
        if ($diagnosticId) {
            abort_unless($user->hasPermission('devices.view') && $user->hasPermission('devices.diagnostics'), 403);
            $d = DeviceCommand::where('ticket_id', $ticket->id)->whereIn('status', ['succeeded', 'failed'])->whereNotNull('result')->findOrFail($diagnosticId);
            $context['diagnostic'] = ['command' => $d->command, 'status' => $d->status, 'finished_at' => $d->finished_at?->toIso8601String(), 'summary' => $this->redact($d->summary ?? '', 1000), 'checks' => collect($d->result)->take(24)->map(fn ($c) => ['name' => $this->redact($c['name'], 120), 'status' => $c['status'], 'detail' => $this->redact($c['detail'], 500)])->all()];
        }
        $sources = $articles->map(fn ($a) => ['id' => $a->id, 'version' => $a->version])->all();
        $hash = hash('sha256', json_encode([$ticket->version, $sources, $context], JSON_THROW_ON_ERROR));

        return ['context' => $context, 'hash' => $hash, 'sources' => $sources];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class AiRun extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['result', 'context_hash', 'request_key'];

    protected function casts(): array
    {
        return ['result' => 'encrypted:array', 'ticket_version' => 'integer', 'started_at' => 'datetime', 'finished_at' => 'datetime'];
    }

    public function sources()
    {
        return $this->belongsToMany(KnowledgeArticle::class, 'ai_run_sources', 'run_id', 'article_id')->withPivot('version');
    }
}

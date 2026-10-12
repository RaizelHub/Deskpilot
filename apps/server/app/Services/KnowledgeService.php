<?php

namespace App\Services;

use App\Models\KnowledgeArticle;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class KnowledgeService
{
    public const VECTOR = "to_tsvector('simple', title || ' ' || summary || ' ' || body)";

    public function visible(User $user, bool $publishedOnly = false): Builder
    {
        $q = KnowledgeArticle::query();
        if (! $user->hasPermission('knowledge.view')) {
            return $q->whereRaw('1=0');
        }
        if ($publishedOnly || ! $user->hasPermission('knowledge.manage')) {
            $q->where('status', 'published');
        }
        if (! $user->hasPermission('knowledge.staff')) {
            $q->where('visibility', 'everyone');
        }

        return $q;
    }

    public function related(User $user, string $text, ?string $exclude = null)
    {
        preg_match_all('/[\pL\pN]{3,40}/u', mb_strtolower($text), $m);
        $tokens = array_slice(array_values(array_diff(array_unique($m[0]), ['the', 'and', 'with', 'this', 'that', 'have', 'from', 'cannot', 'when', 'please', 'issue', 'ticket', 'for', 'not'])), 0, 12);
        if (! $tokens) {
            return collect();
        }
        $query = implode(' | ', array_map(fn ($t) => "'".str_replace("'", '', $t)."'", $tokens));

        return $this->visible($user, true)->when($exclude, fn ($q) => $q->where('id', '!=', $exclude))->whereRaw(self::VECTOR." @@ to_tsquery('simple', ?)", [$query])->orderByRaw('ts_rank('.self::VECTOR.", to_tsquery('simple', ?)) DESC", [$query])->orderBy('id')->limit(3)->get();
    }

    public function save(User $user, array $data, ?string $id): KnowledgeArticle
    {
        return DB::transaction(function () use ($user, $data, $id) {
            $a = $id ? $this->visible($user)->whereKey($id)->lockForUpdate()->firstOrFail() : new KnowledgeArticle;
            if ($id) {
                abort_if($a->version !== $data['version'], 409, 'This article changed. Refresh before saving.');
            }
            $a->fill(collect($data)->except(['tags', 'version'])->all());
            $a->author_id = $a->author_id ?? $user->id;
            $a->version = ($a->version ?? 0) + 1;
            $a->save();
            $a->tags()->delete();
            $a->tags()->createMany(array_map(fn ($t) => ['name' => $t], array_values(array_unique(array_map(fn ($t) => mb_strtolower(trim($t)), $data['tags'])))));
            app(Audit::class)->record($id ? 'knowledge.updated' : 'knowledge.created', $user, $a, ['status' => $a->status, 'visibility' => $a->visibility, 'version' => $a->version]);

            return $a->load(['category', 'tags']);
        });
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\KnowledgeCategory;
use App\Services\KnowledgeService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class KnowledgeController extends Controller
{
    public function categories()
    {
        return response()->json(['data' => KnowledgeCategory::orderBy('name')->get()]);
    }

    public function index(Request $r, KnowledgeService $s)
    {
        $d = $r->validate(['search' => 'nullable|string|max:200', 'category' => 'nullable|uuid', 'tag' => 'nullable|string|max:40', 'status' => ['nullable', Rule::in(['draft', 'published', 'archived'])], 'page' => 'integer|min:1']);
        $q = $s->visible($r->user())->with(['category', 'tags'])->select(['id', 'category_id', 'title', 'summary', 'status', 'visibility', 'version', 'updated_at']);
        if ($v = $d['search'] ?? null) {
            $q->whereRaw(KnowledgeService::VECTOR." @@ plainto_tsquery('simple', ?)", [$v]);
        }

        return $q->when($d['category'] ?? null, fn ($q, $v) => $q->where('category_id', $v))->when($d['status'] ?? null, fn ($q, $v) => $q->where('status', $v))->when($d['tag'] ?? null, fn ($q, $v) => $q->whereHas('tags', fn ($q) => $q->where('name', mb_strtolower($v))))->orderByDesc('updated_at')->orderBy('id')->paginate(12);
    }

    public function show(Request $r, string $article, KnowledgeService $s)
    {
        $a = $s->visible($r->user())->with(['category', 'tags'])->findOrFail($article);

        return response()->json(['data' => $a, 'html' => preg_replace('/<img\b[^>]*>/i', '', (string) Str::markdown($a->body, ['html_input' => 'strip', 'allow_unsafe_links' => false, 'max_nesting_level' => 20])), 'related' => $s->related($r->user(), $a->title, $a->id)->map->only(['id', 'title', 'summary'])]);
    }

    public function save(Request $r, KnowledgeService $s, ?string $article = null)
    {
        $d = $r->validate(['title' => 'required|string|min:3|max:160', 'summary' => 'required|string|min:3|max:400', 'body' => 'required|string|min:10|max:30000', 'category_id' => 'required|uuid|exists:knowledge_categories,id', 'visibility' => ['required', Rule::in(['everyone', 'staff'])], 'status' => ['required', Rule::in(['draft', 'published', 'archived'])], 'tags' => 'present|array|max:10', 'tags.*' => 'required|string|min:1|max:40', 'version' => $article ? 'required|integer|min:1' : 'prohibited']);
        abort_if($d['visibility'] === 'staff' && ! $r->user()->hasPermission('knowledge.staff'), 403);

        return response()->json(['data' => $s->save($r->user(), $d, $article)], $article ? 200 : 201);
    }
}

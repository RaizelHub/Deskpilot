<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class KnowledgeArticle extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['version' => 'integer'];
    }

    public function category()
    {
        return $this->belongsTo(KnowledgeCategory::class);
    }

    public function tags()
    {
        return $this->hasMany(KnowledgeArticleTag::class, 'article_id');
    }
}

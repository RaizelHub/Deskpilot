<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class KnowledgeCategory extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $guarded = ['id'];
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WebhookSubscription extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $guarded = [];
}

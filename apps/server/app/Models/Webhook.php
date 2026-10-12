<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Webhook extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return ['url' => 'encrypted', 'secret' => 'encrypted', 'enabled' => 'boolean', 'version' => 'integer'];
    }

    public function subscriptions()
    {
        return $this->hasMany(WebhookSubscription::class);
    }
}

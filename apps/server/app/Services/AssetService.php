<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\Device;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class AssetService
{
    private function event(Asset $asset, User $actor, string $action, string $detail, array $metadata = []): void
    {
        $asset->events()->create(['actor_id' => $actor->id, 'action' => $action, 'detail' => $detail, 'created_at' => now()]);
        app(Audit::class)->record('asset.'.$action, $actor, $asset, ['detail' => $detail, ...$metadata]);
    }

    private function device(User $actor, ?string $id, ?Asset $asset): void
    {
        if ($id === $asset?->device_id) {
            return;
        }
        abort_unless($actor->hasPermission('devices.view'), 403, 'Device visibility is required to change an enrollment link.');
        if (! $id) {
            return;
        }
        $device = Device::whereKey($id)->lockForUpdate()->firstOrFail();
        abort_if($device->revoked_at, 422, 'Choose an enrolled device that has not been revoked.');
        abort_if(Asset::where('device_id', $id)->when($asset, fn ($q) => $q->where('id', '!=', $asset->id))->exists(), 409, 'That device is already linked to another asset.');
    }

    public function save(User $actor, array $data, ?string $id = null): Asset
    {
        return DB::transaction(function () use ($actor, $data, $id) {
            $asset = $id ? Asset::whereKey($id)->lockForUpdate()->firstOrFail() : null;
            if ($asset) {
                abort_if($asset->version !== $data['version'], 409, 'This asset changed. Refresh before saving.');
            }
            // Serialize tag allocation across concurrent creates/renames, including case normalization.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['asset-tag:'.$data['tag']]);
            abort_if(Asset::where('tag', $data['tag'])->when($asset, fn ($q) => $q->where('id', '!=', $asset->id))->exists(), 422, 'This asset tag is already in use.');
            $this->device($actor, $data['device_id'] ?? null, $asset);
            $assigned = $asset?->currentAssignment()->exists() ?? false;
            abort_if($assigned && $data['status'] !== 'in_use', 422, 'Return the current assignment before changing this asset status.');
            abort_if(! $assigned && $data['status'] === 'in_use', 422, 'Use Assign asset to put an asset in use.');
            $before = $asset?->only(array_keys($data)) ?? [];
            unset($data['version']);
            if ($asset) {
                $asset->update([...$data, 'version' => $asset->version + 1]);
            } else {
                $asset = Asset::create([...$data, 'version' => 1]);
            }
            $this->event($asset, $actor, $id ? 'updated' : 'created', $id ? 'Asset details updated.' : 'Asset registered.', ['before' => $before, 'after' => $asset->only(array_keys($data))]);

            return $asset;
        });
    }

    public function assign(User $actor, string $id, array $data): Asset
    {
        return DB::transaction(function () use ($actor, $id, $data) {
            $asset = Asset::whereKey($id)->lockForUpdate()->firstOrFail();
            abort_if($asset->version !== $data['version'], 409, 'This asset changed. Refresh before assigning.');
            abort_unless(in_array($asset->status, ['available', 'in_use'], true), 422, 'Only available or in-use assets can be assigned.');
            $user = User::whereKey($data['user_id'])->lockForUpdate()->firstOrFail();
            abort_unless($user->is_active, 422, 'Choose an active employee.');
            $current = $asset->currentAssignment()->first();
            abort_if($current?->user_id === $user->id, 422, 'This asset is already assigned to that employee.');
            if ($current) {
                $current->update(['returned_at' => now(), 'returned_by' => $actor->id, 'return_notes' => 'Reassigned: '.$data['notes']]);
            }
            $asset->assignments()->create(['user_id' => $user->id, 'assigned_by' => $actor->id, 'assigned_at' => now(), 'notes' => $data['notes']]);
            $asset->update(['status' => 'in_use', 'version' => $asset->version + 1]);
            $this->event($asset, $actor, $current ? 'reassigned' : 'assigned', ($current ? 'Reassigned to ' : 'Assigned to ').$user->name.'.', ['user_id' => $user->id, 'previous_user_id' => $current?->user_id, 'notes' => $data['notes']]);

            return $asset;
        });
    }

    public function returnAsset(User $actor, string $id, array $data): Asset
    {
        return DB::transaction(function () use ($actor, $id, $data) {
            $asset = Asset::whereKey($id)->lockForUpdate()->firstOrFail();
            abort_if($asset->version !== $data['version'], 409, 'This asset changed. Refresh before returning.');
            $assignment = $asset->currentAssignment()->first();
            abort_unless($assignment, 409, 'This asset has no current assignment.');
            $assignment->update(['returned_at' => now(), 'returned_by' => $actor->id, 'return_notes' => $data['notes']]);
            $asset->update(['status' => $data['status'], 'version' => $asset->version + 1]);
            $this->event($asset, $actor, 'returned', 'Asset returned; status is '.str_replace('_', ' ', $data['status']).'.', ['user_id' => $assignment->user_id, 'notes' => $data['notes']]);

            return $asset;
        });
    }
}
